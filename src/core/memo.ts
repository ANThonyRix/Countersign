import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { keccak256, recoverMessageAddress, toBytes } from "viem";
import type { LocalAccount } from "viem/accounts";
import { config, ROOT } from "../config.ts";
import type { Decision, Evidence, Finding } from "./types.ts";

export interface MemoBody {
  memo_version: 1;
  id: string;
  created_at: string;
  pack: string;
  mission: string;
  subject: { name: string; fields: Record<string, string> };
  decision: Decision;
  decision_label: string;
  reasons: string[];
  findings: Finding[];
  evidence: Evidence[];
  coverage: { total: number; answered: number; unknown: number; skipped: number };
  cost: { total_usd: number; paid_calls: number; budget_usd: number; per_finding_usd: number };
  network: { node: string; chain: string; asset: string };
  agent: string;
}

export interface Memo extends MemoBody {
  digest: `0x${string}`;
  signature: `0x${string}`;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

export function memoDigest(body: MemoBody): `0x${string}` {
  return keccak256(toBytes(canonical(body)));
}

/** EIP-191 signature by the agent wallet over the memo digest. Anyone can recover the signer. */
export async function signMemo(body: MemoBody, account: LocalAccount): Promise<Memo> {
  const digest = memoDigest(body);
  const signature = await account.signMessage({ message: { raw: digest } });
  return { ...body, digest, signature };
}

export async function verifyMemoSignature(memo: Memo): Promise<{ digestMatches: boolean; signer: string; signerMatches: boolean }> {
  const { digest, signature, ...body } = memo;
  const recomputed = memoDigest(body as MemoBody);
  const signer = await recoverMessageAddress({ message: { raw: digest }, signature });
  return {
    digestMatches: recomputed === digest,
    signer,
    signerMatches: signer.toLowerCase() === memo.agent.toLowerCase(),
  };
}

const memoDir = () => path.join(config.dataDir, "memos");

export function saveMemo(memo: Memo): string {
  if (!existsSync(memoDir())) mkdirSync(memoDir(), { recursive: true });
  const file = path.join(memoDir(), `${memo.id}.json`);
  writeFileSync(file, JSON.stringify(memo, null, 2));
  writeFileSync(path.join(memoDir(), `${memo.id}.md`), renderMarkdown(memo));
  return file;
}

// Examples ship with the repo, so they resolve from ROOT even when COUNTERSIGN_DATA_DIR points elsewhere.
const EXAMPLES_DIR = path.join(ROOT, "examples");

export function loadMemo(id: string): Memo | undefined {
  if (!/^[a-z0-9-]+$/i.test(id)) return undefined;
  for (const dir of [memoDir(), EXAMPLES_DIR]) {
    const file = path.join(dir, `${id}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Memo;
  }
  return undefined;
}

export interface MemoSummary {
  id: string;
  created_at: string;
  pack: string;
  subject: string;
  decision: Decision;
  decision_label: string;
  cost_usd: number;
  checks: number;
  source: "run" | "example";
}

export function listMemos(): MemoSummary[] {
  const out: MemoSummary[] = [];
  for (const [dir, source] of [[memoDir(), "run"], [EXAMPLES_DIR, "example"]] as const) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const m = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Memo;
        if (out.some((o) => o.id === m.id)) continue;
        out.push({
          id: m.id,
          created_at: m.created_at,
          pack: m.pack,
          subject: m.subject.name,
          decision: m.decision,
          decision_label: m.decision_label,
          cost_usd: m.cost.total_usd,
          checks: m.findings.length,
          source,
        });
      } catch {
        // skip unreadable files
      }
    }
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const icon: Record<string, string> = { clear: "CLEAR", flag: "FLAG", block: "BLOCK", unknown: "UNKNOWN" };

export function renderMarkdown(m: Memo): string {
  const lines: string[] = [];
  lines.push(`# ${m.decision_label}: ${m.subject.name}`);
  lines.push("");
  lines.push(`**${m.mission}** · memo \`${m.id}\` · ${m.created_at}`);
  lines.push("");
  lines.push(`Decision **${m.decision_label}** (${m.decision}). ${m.coverage.answered}/${m.coverage.total} checks answered. Cost **$${m.cost.total_usd.toFixed(4)}** over ${m.cost.paid_calls} paid Telegraph calls.`);
  lines.push("");
  lines.push("## Why");
  for (const r of m.reasons) lines.push(`- ${r}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  lines.push("| Check | Result | Corroboration | Evidence |");
  lines.push("|---|---|---|---|");
  for (const f of m.findings) {
    const ev = f.evidence
      .map((id) => m.evidence.find((e) => e.id === id))
      .filter(Boolean)
      .map((e) => (e!.signalHash ? `\`${e!.signalHash.slice(0, 10)}…\`` : e!.error ? "error" : "—"))
      .join(", ");
    lines.push(`| ${f.title} | **${icon[f.verdict]}** ${f.summary.replace(/\|/g, "\\|")} | ${f.corroboration} | ${ev || "—"} |`);
  }
  lines.push("");
  lines.push("## Evidence ledger");
  lines.push("");
  lines.push("| # | Intent | Miner | Signal hash | Receipt | Cost | Verified |");
  lines.push("|---|---|---|---|---|---|---|");
  m.evidence.forEach((e, i) => {
    const v = e.verification ? (e.verification.nodeVerified && e.verification.localHashMatch ? "yes" : "no") : "—";
    lines.push(
      `| ${i + 1} | ${e.intent}${e.role === "crosscheck" ? " (cross-check)" : ""} | ${e.minerName ?? e.minerId ?? "—"} | ${e.signalHash ? `\`${e.signalHash}\`` : e.error ?? "—"} | ${e.receipt?.receipt_hash ? `\`${e.receipt.receipt_hash.slice(0, 14)}…\`` : "—"} | $${e.costUsd.toFixed(4)} | ${v} |`,
    );
  });
  lines.push("");
  lines.push("## Integrity");
  lines.push("");
  lines.push(`- Agent wallet: \`${m.agent}\``);
  lines.push(`- Memo digest (keccak256 of canonical JSON): \`${m.digest}\``);
  lines.push(`- EIP-191 signature: \`${m.signature}\``);
  lines.push(`- Verify: \`npm run cs -- verify ${m.id}\`, or look up any signal at \`${m.network.node}/engine/v1/signal/<hash>\``);
  lines.push("");
  lines.push("_Countersign reports what Telegraph miners answered, with the agent's own deterministic rules on top. It is decision support for a human desk, not legal or investment advice._");
  return lines.join("\n");
}
