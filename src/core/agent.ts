import { randomUUID } from "node:crypto";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { agentKey, config } from "../config.ts";
import { ask, quote, rankedMiners, verifySignal, type AskOutcome } from "../telegraph/client.ts";
import { EngineError, type AskInput } from "../telegraph/types.ts";
import type { PackDefinition } from "./types.ts";
import { Budget, atomicToUsd } from "./budget.ts";
import { agrees } from "./evaluators.ts";
import { signMemo, saveMemo, type Memo } from "./memo.ts";
import { decide } from "./policy.ts";
import type { AgentEvent, Assessment, CheckSpec, Evidence, Finding } from "./types.ts";

const MAX_CHECKS = 16;
const MAX_FALLBACK_MINERS = 3;

export interface RunOptions {
  budget?: Budget;
  account?: LocalAccount;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  /** Skip the second-miner cross-check (cheaper, weaker). */
  noCrosscheck?: boolean;
}

export function planContext() {
  const mainnetClient = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
  return {
    // A few blocks behind the head so every archive-capable miner has it.
    latestBlock: async () => Number(await mainnetClient.getBlockNumber()) - 5,
  };
}

/** Free dry run: plans the checks and asks the node for a price on each, without paying. */
export async function dryRun(pack: PackDefinition, subject: Record<string, string>) {
  const checks = await pack.plan(subject, planContext());
  const quotes = await Promise.all(
    checks.map(async (c) => {
      const q = await quote(c.input).catch((err: Error) => ({ ok: false, status: 0, code: err.message }) as Awaited<ReturnType<typeof quote>>);
      return { id: c.id, title: c.title, intent: c.intent, critical: !!c.critical, ok: q.ok, priceUsd: q.priceUsd, status: q.status, code: q.code, problems: q.problems };
    }),
  );
  const unit = quotes.find((q) => q.priceUsd)?.priceUsd ?? 0.01;
  const base = quotes.reduce((s, q) => s + (q.priceUsd ?? unit), 0);
  const crossMax = checks.filter((c) => c.critical).length * unit;
  return { checks: quotes, estimate: { baseUsd: base, worstCaseUsd: base + crossMax, budgetUsd: config.maxUsdPerRun } };
}

class Runner {
  readonly evidence: Evidence[] = [];
  readonly findings = new Map<string, Finding>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly pack: PackDefinition,
    private readonly account: LocalAccount,
    private readonly budget: Budget,
    private readonly emit: (e: AgentEvent) => void,
    private readonly opts: RunOptions,
  ) {}

  private record(checkId: string, role: Evidence["role"], intent: string, outcome?: AskOutcome, error?: unknown): Evidence {
    const r = outcome?.response;
    const e: Evidence = {
      id: `ev${this.evidence.length + 1}`,
      checkId,
      role,
      intent,
      routedIntent: r?.intent,
      minerId: outcome?.minerId,
      minerName: r?.miner_name,
      signalHash: r?.signal_hash,
      receipt: outcome?.receipt,
      costUsd: outcome?.paidUsd ?? 0,
      durationMs: r?.duration_ms,
      resultShape: r?.result_shape,
      fieldStatus: r?.field_status,
      result: r ? trimResult(r.result) : undefined,
      reasoning: r?.reasoning,
      at: new Date().toISOString(),
      error: error ? describe(error) : undefined,
    };
    this.evidence.push(e);
    this.emit({ type: "evidence", evidence: e });
    return e;
  }

  /** Buys one answer. Pinned intents walk ranked miners directly, then fall back to the router. */
  private async buy(check: CheckSpec, role: Evidence["role"], excludeMiner?: string): Promise<{ outcome?: AskOutcome; error?: unknown; tried: string[] }> {
    const tried: string[] = [];
    const direct = role === "crosscheck" || check.pinIntent;
    if (direct) {
      const miners = (await rankedMiners(check.intent).catch(() => [])).filter(
        (m) => m.id !== excludeMiner && m.slug !== excludeMiner,
      );
      let lastError: unknown;
      for (const m of miners.slice(0, MAX_FALLBACK_MINERS)) {
        if (this.opts.signal?.aborted) break;
        tried.push(m.slug);
        this.emit({ type: "check_start", checkId: check.id, title: check.title, role, miner: m.slug });
        const input: AskInput = "query" in check.input ? { intent: check.intent, query: check.input.query } : check.input;
        try {
          return { outcome: await ask(input, { account: this.account, budget: this.budget, minerId: m.id, signal: this.opts.signal }), tried };
        } catch (err) {
          lastError = err;
          if (err instanceof EngineError && err.code === "payment_refused") return { error: err, tried };
          // 404/422/500/503 on a direct ask: no charge. Move to the next ranked miner.
        }
      }
      if (role === "crosscheck") return { error: lastError ?? new Error("no alternative miner available"), tried };
    }
    this.emit({ type: "check_start", checkId: check.id, title: check.title, role });
    try {
      return { outcome: await ask(check.input, { account: this.account, budget: this.budget, signal: this.opts.signal }), tried };
    } catch (err) {
      return { error: err, tried };
    }
  }

  async runCheck(check: CheckSpec): Promise<CheckSpec[]> {
    if (this.opts.signal?.aborted) return [];
    const finding: Finding = {
      checkId: check.id,
      title: check.title,
      why: check.why,
      verdict: "unknown",
      summary: "",
      critical: !!check.critical,
      corroboration: "single",
      evidence: [],
      escalatedFrom: check.escalatedFrom,
    };

    if (!this.budget.canAfford(10_000n)) {
      finding.skipped = "budget";
      finding.summary = `Not bought: run budget of $${config.maxUsdPerRun.toFixed(2)} reached.`;
      this.findings.set(check.id, finding);
      this.emit({ type: "skip", checkId: check.id, reason: "budget" });
      this.emit({ type: "finding", finding });
      return [];
    }

    const primary = await this.buy(check, "primary");
    const ev = this.record(check.id, "primary", check.intent, primary.outcome, primary.error);
    finding.evidence.push(ev.id);

    if (!primary.outcome) {
      finding.summary = `No answer: ${describe(primary.error)}`;
      if (primary.error instanceof EngineError && primary.error.code === "payment_refused") finding.skipped = "budget";
      this.findings.set(check.id, finding);
      this.emit({ type: "finding", finding });
      return [];
    }

    let a: Assessment = check.evaluate(primary.outcome.response);
    if (check.pinIntent && primary.outcome.response.intent && primary.outcome.response.intent !== check.intent && a.verdict !== "unknown") {
      a = { ...a, summary: `${a.summary} (router answered as ${primary.outcome.response.intent})` };
    }
    ev.verdict = a.verdict;
    finding.verdict = a.verdict;
    finding.summary = a.summary;
    finding.facts = a.facts;
    finding.corroboration = a.verdict === "clear" && !check.critical ? "not_needed" : "single";

    // A critical answer that is not clean gets an independent second miner before it counts.
    if (check.critical && a.verdict !== "clear" && !this.opts.noCrosscheck) {
      const second = await this.buy(check, "crosscheck", primary.outcome.minerId);
      const ev2 = this.record(check.id, "crosscheck", check.intent, second.outcome, second.error);
      finding.evidence.push(ev2.id);
      if (second.outcome) {
        const b = check.evaluate(second.outcome.response);
        ev2.verdict = b.verdict;
        const agreement = agrees(a, b);
        if (a.verdict === "unknown" && b.verdict !== "unknown") {
          // The second miner answered where the first could not: take its answer, single-sourced.
          finding.verdict = b.verdict;
          finding.summary = `${b.summary} (second miner; first returned no usable answer)`;
          finding.facts = b.facts;
          a = b;
        } else if (agreement === true) {
          finding.corroboration = "confirmed";
          finding.summary = `${a.summary} Confirmed by a second miner.`;
        } else if (agreement === false) {
          finding.corroboration = "disputed";
          finding.summary = `${a.summary} A second miner disagrees: ${b.summary}`;
        }
      }
    }

    this.findings.set(check.id, finding);
    this.emit({ type: "finding", finding });

    const next = (check.followUps?.(a, primary.outcome.response) ?? []).filter((c) => !this.seen.has(c.id));
    if (next.length) {
      for (const c of next) c.escalatedFrom = check.id;
      this.emit({ type: "escalate", from: check.id, checks: next.map((c) => ({ id: c.id, title: c.title })), reason: a.summary });
    }
    return next;
  }

  async runAll(initial: CheckSpec[]): Promise<void> {
    const queue = [...initial];
    for (const c of queue) this.seen.add(c.id);
    const active = new Set<Promise<void>>();

    const launch = (c: CheckSpec) => {
      const p = this.runCheck(c)
        .then((more) => {
          for (const m of more) {
            if (this.seen.has(m.id) || this.seen.size >= MAX_CHECKS) continue;
            this.seen.add(m.id);
            queue.push(m);
          }
        })
        .catch((err) => this.emit({ type: "error", message: `${c.id}: ${describe(err)}` }))
        .finally(() => active.delete(p));
      active.add(p);
    };

    while (queue.length || active.size) {
      while (queue.length && active.size < config.concurrency && !this.opts.signal?.aborted) launch(queue.shift()!);
      if (this.opts.signal?.aborted) queue.length = 0;
      if (active.size) await Promise.race(active);
    }
  }

  async verifyAll(): Promise<void> {
    await Promise.all(
      this.evidence
        .filter((e) => e.signalHash)
        .map(async (e) => {
          const v = await verifySignal(e.signalHash!, this.account.address);
          e.verification = {
            found: v.found,
            nodeVerified: v.nodeVerified,
            localHashMatch: v.localHashMatch,
            payerMatches: !!v.payer && v.payer.toLowerCase() === this.account.address.toLowerCase(),
          };
          this.emit({ type: "verify", evidenceId: e.id, ok: v.nodeVerified && v.localHashMatch });
        }),
    );
  }
}

export async function runPack(pack: PackDefinition, subject: Record<string, string>, opts: RunOptions = {}): Promise<Memo> {
  const account = opts.account ?? privateKeyToAccount(agentKey());
  const budget = opts.budget ?? new Budget();
  const emit = opts.onEvent ?? (() => {});

  const checks = await pack.plan(subject, planContext());
  emit({
    type: "plan",
    checks: checks.map((c) => ({ id: c.id, title: c.title, intent: c.intent, critical: !!c.critical })),
    estimateUsd: checks.length * 0.01,
  });

  const runner = new Runner(pack, account, budget, emit, opts);
  await runner.runAll(checks);
  // Signals are indexed a moment after the ask returns.
  await new Promise((r) => setTimeout(r, 1500));
  await runner.verifyAll();

  const order = [...runner.findings.keys()];
  const findings = order.map((id) => runner.findings.get(id)!);
  const policy = decide(findings);
  const label = pack.labels[policy.decision];
  emit({ type: "decision", decision: policy.decision, label, reasons: policy.reasons });

  const total = runner.evidence.reduce((s, e) => s + e.costUsd, 0);
  const paidCalls = runner.evidence.filter((e) => e.costUsd > 0).length;
  const memo = await signMemo(
    {
      memo_version: 1,
      id: `${pack.id}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
      created_at: new Date().toISOString(),
      pack: pack.id,
      mission: pack.mission,
      subject: { name: pack.subjectName(subject), fields: subject },
      decision: policy.decision,
      decision_label: label,
      reasons: policy.reasons,
      findings,
      evidence: runner.evidence,
      coverage: policy.coverage,
      cost: {
        total_usd: round(total),
        paid_calls: paidCalls,
        budget_usd: atomicToUsd(budget.runCap),
        per_finding_usd: findings.length ? round(total / findings.length) : 0,
      },
      network: { node: config.node, chain: config.network, asset: config.usdc },
      agent: account.address,
    },
    account,
  );
  saveMemo(memo);
  emit({ type: "memo", memoId: memo.id });
  return memo;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function describe(err: unknown): string {
  if (!err) return "unknown error";
  if (err instanceof EngineError) return err.message;
  return (err as Error).message ?? String(err);
}

/** Keep the memo readable: raw miner output can be large. The signal hash covers the full answer. */
function trimResult(result: unknown): unknown {
  const json = JSON.stringify(result ?? null);
  if (json.length <= 4000) return result;
  return { truncated: true, excerpt: json.slice(0, 4000) };
}
