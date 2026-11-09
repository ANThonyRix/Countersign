import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { config, hasAgentKey } from "./config.ts";
import { dryRun, runPack } from "./core/agent.ts";
import { daySpend } from "./core/budget.ts";
import { loadMemo, renderMarkdown, verifyMemoSignature, type Memo } from "./core/memo.ts";
import type { AgentEvent } from "./core/types.ts";
import { mintTestUsdc, walletStatus } from "./core/wallet.ts";
import { getPack, normaliseSubject, packs } from "./packs/index.ts";
import { verifySignal } from "./telegraph/client.ts";

const HELP = `countersign: counterparty due diligence bought from Telegraph miners

Usage: npm run cs -- <command> [options]

  wallet                         Agent address, Sepolia ETH, test USDC, escrow credit
  mint [--amount 10]             Mint Telegraph test USDC to the agent wallet (needs Sepolia ETH)
  packs                          List diligence packs and their fields
  plan <pack> [fields]           Free dry run: plan the checks and get a price quote for each
  run <pack> [fields]            Run the agent for real: pays per check, writes a signed memo
  verify <memo-id|file>          Re-check a memo: signature, digest, every signal hash
  show <memo-id>                 Print a memo as Markdown

Fields are passed as --field value, e.g.
  npm run cs -- run commodities --seller "Trafigura Pte Ltd" --jurisdiction Singapore \\
    --vessel "EVER GIVEN" --imo 9811000 --port Rotterdam
Add --example to use the pack's built-in example subject.
`;

const color = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const verdictColor = { clear: color.green, flag: color.yellow, block: color.red, unknown: color.dim };

function subjectFrom(packId: string, argv: string[]) {
  const pack = getPack(packId);
  const options = Object.fromEntries(pack.fields.map((f) => [f.name, { type: "string" as const }]));
  const { values } = parseArgs({ args: argv, options: { ...options, example: { type: "boolean" }, "no-crosscheck": { type: "boolean" } }, strict: true });
  const raw = values.example ? { ...pack.example, ...stripFlags(values) } : stripFlags(values);
  return { pack, subject: normaliseSubject(pack, raw), noCrosscheck: !!values["no-crosscheck"] };
}

function stripFlags(values: Record<string, unknown>) {
  const { example: _e, "no-crosscheck": _n, ...rest } = values;
  return rest as Record<string, string>;
}

function printEvent(e: AgentEvent) {
  switch (e.type) {
    case "plan":
      console.log(color.bold(`Plan: ${e.checks.length} checks`));
      for (const c of e.checks) console.log(`  - ${c.title} ${color.dim(`[${c.intent}]${c.critical ? " critical" : ""}`)}`);
      break;
    case "check_start":
      console.log(color.dim(`  > ${e.role === "crosscheck" ? "cross-check" : "buying"} ${e.title}${e.miner ? ` via ${e.miner}` : ""}`));
      break;
    case "evidence":
      if (e.evidence.error) console.log(color.dim(`    x ${e.evidence.error}`));
      else console.log(color.dim(`    paid $${e.evidence.costUsd.toFixed(4)} to ${e.evidence.minerName ?? e.evidence.minerId} · signal ${e.evidence.signalHash?.slice(0, 18)}…`));
      break;
    case "finding":
      console.log(`  ${verdictColor[e.finding.verdict](e.finding.verdict.toUpperCase().padEnd(7))} ${e.finding.title}: ${e.finding.summary}`);
      break;
    case "escalate":
      console.log(color.yellow(`  ! escalating: ${e.checks.map((c) => c.title).join(", ")}`));
      break;
    case "skip":
      console.log(color.dim(`  - skipped ${e.checkId} (${e.reason})`));
      break;
    case "decision":
      console.log("");
      console.log(color.bold(`Decision: ${e.label} (${e.decision})`));
      for (const r of e.reasons) console.log(`  · ${r}`);
      break;
    case "error":
      console.log(color.red(`  error: ${e.message}`));
      break;
  }
}

async function verifyMemo(memo: Memo) {
  const sig = await verifyMemoSignature(memo);
  console.log(`Memo ${memo.id}`);
  console.log(`  digest matches content: ${sig.digestMatches ? color.green("yes") : color.red("NO")}`);
  console.log(`  signed by agent ${memo.agent}: ${sig.signerMatches ? color.green("yes") : color.red(`NO (recovered ${sig.signer})`)}`);
  let ok = sig.digestMatches && sig.signerMatches;
  for (const e of memo.evidence.filter((x) => x.signalHash)) {
    const v = await verifySignal(e.signalHash!, memo.agent);
    const good = v.found && v.nodeVerified && v.localHashMatch && !v.error;
    ok &&= good;
    console.log(
      `  ${good ? color.green("ok ") : color.red("BAD")} ${e.intent.padEnd(36)} ${e.signalHash!.slice(0, 18)}… node:${v.nodeVerified} keccak:${v.localHashMatch} payer:${v.payer ?? "?"}${v.error ? ` ${v.error}` : ""}`,
    );
  }
  console.log(ok ? color.green("Memo verified.") : color.red("Memo FAILED verification."));
  return ok;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "wallet": {
      if (!hasAgentKey()) throw new Error("no agent key. Run: npm run wallet:new");
      const s = await walletStatus();
      const day = daySpend();
      console.log(`Agent wallet  ${s.address}`);
      console.log(`Sepolia ETH   ${s.eth}`);
      console.log(`Test USDC     ${s.usdc}`);
      console.log(`Escrow credit ${s.escrowCredit}`);
      console.log(`Spent today   $${day.spentUsd.toFixed(4)} of $${day.capUsd.toFixed(2)} (${day.calls} calls)`);
      console.log(`Explorer      ${s.explorer}`);
      break;
    }
    case "mint": {
      const { values } = parseArgs({ args: rest, options: { amount: { type: "string", default: "10" } } });
      const hash = await mintTestUsdc(Number(values.amount));
      console.log(`Minted ${values.amount} test USDC: https://sepolia.etherscan.io/tx/${hash}`);
      break;
    }
    case "packs":
      for (const p of Object.values(packs)) {
        console.log(color.bold(`${p.id}`) + `  ${p.mission}`);
        console.log(`  ${p.tagline}`);
        for (const f of p.fields) console.log(color.dim(`    --${f.name}${f.required ? " (required)" : ""}  ${f.label}`));
      }
      break;
    case "plan": {
      const { pack, subject } = subjectFrom(rest[0], rest.slice(1));
      const result = await dryRun(pack, subject);
      console.log(color.bold(`${pack.title}: ${pack.subjectName(subject)}`));
      for (const c of result.checks) {
        const price = c.ok ? color.green(`$${c.priceUsd?.toFixed(4)}`) : color.red(`${c.status} ${c.code}`);
        console.log(`  ${price.padEnd(18)} ${c.title} ${color.dim(`[${c.intent}]${c.critical ? " critical" : ""}`)}`);
        if (c.problems) console.log(color.red(`      ${JSON.stringify(c.problems)}`));
      }
      console.log(`Estimated cost $${result.estimate.baseUsd.toFixed(4)}, up to $${result.estimate.worstCaseUsd.toFixed(4)} with cross-checks. Run budget $${result.estimate.budgetUsd.toFixed(2)}.`);
      console.log(color.dim("Nothing was paid. The node quoted each request before payment."));
      break;
    }
    case "run": {
      const { pack, subject, noCrosscheck } = subjectFrom(rest[0], rest.slice(1));
      console.log(color.bold(`${pack.title}: ${pack.subjectName(subject)}`));
      console.log(color.dim(`Budget $${config.maxUsdPerRun.toFixed(2)} per run, $${config.maxUsdPerDay.toFixed(2)} per day. Requests are public on the Telegraph feed.`));
      const memo = await runPack(pack, subject, { onEvent: printEvent, noCrosscheck });
      console.log("");
      console.log(`Cost $${memo.cost.total_usd.toFixed(4)} over ${memo.cost.paid_calls} paid calls.`);
      console.log(`Memo ${memo.id} written to data/memos/. Verify with: npm run cs -- verify ${memo.id}`);
      break;
    }
    case "verify": {
      const target = rest[0];
      if (!target) throw new Error("usage: verify <memo-id|file>");
      const memo = target.endsWith(".json") ? (JSON.parse(readFileSync(target, "utf8")) as Memo) : loadMemo(target);
      if (!memo) throw new Error(`memo ${target} not found`);
      const ok = await verifyMemo(memo);
      process.exitCode = ok ? 0 : 1;
      break;
    }
    case "show": {
      const memo = loadMemo(rest[0] ?? "");
      if (!memo) throw new Error(`memo ${rest[0]} not found`);
      console.log(renderMarkdown(memo));
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  console.error(color.red(`error: ${(err as Error).message}`));
  process.exitCode = 1;
});
