import { privateKeyToAccount } from "viem/accounts";
import { agentKey, config } from "../config.ts";
import { Budget } from "../core/budget.ts";
import { signMemo, verifyMemoSignature, type Memo } from "../core/memo.ts";
import type { Evidence } from "../core/types.ts";
import { ask, computeSignalHash, getSignal, quote, verifySignal } from "../telegraph/client.ts";
import { solanaDevnet, solanaUsdc, startupSolanaSigner } from "../telegraph/solana.ts";

export const marketIntent = "CRYPTO_PRICE_USD";
export const policyId = "sol-liquidity-20pct-v1";
const request = { intent: marketIntent, params: { symbol: "SOL" } };
const venues = ["crypto-kraken", "crypto-coinbase"] as const;
const maxAgeMs = 15 * 60_000;
const paymentCeiling = 10_000n;

function priceCents(result: unknown): number | undefined {
  if (!result || typeof result !== "object" || !("price_usd" in result)) return;
  if (typeof result.price_usd !== "number" || !Number.isFinite(result.price_usd)) return;
  const cents = Math.floor(result.price_usd * 100 + 1e-8);
  return cents >= 1 && cents <= 10_000_000 ? cents : undefined;
}

export function consensusPrice(prices: number[]): number | undefined {
  if (prices.length !== 2 || prices.some(p => !Number.isSafeInteger(p) || p < 1 || p > 10_000_000)) return;
  const [low, high] = [...prices].sort((a, b) => a - b);
  // Use the lower price and require agreement within 100 basis points of it.
  if ((high - low) * 100 <= low) return low;
}

export async function verifyMarket(memo: Memo, at = Date.now()): Promise<{
  ok: boolean; price?: number; validUntil?: number; error?: string;
}> {
  try {
    const signature = await verifyMemoSignature(memo);
    if (!Number.isFinite(at) || !signature.digestMatches || !signature.signerMatches || memo.pack !== "confidential-market" ||
      memo.network.chain !== solanaDevnet || !memo.payment_payer || memo.evidence.length !== venues.length ||
      new Set(memo.evidence.map(evidence => evidence.receipt?.tx_hash)).size !== venues.length) {
      return { ok: false, error: "Market report does not match the signed Devnet market policy." };
    }
    const quotes = await Promise.all(venues.map(async (venue) => {
      const evidence = memo.evidence.find(item => item.minerId === venue);
      if (!evidence?.signalHash) throw new Error(`Missing receipt for ${venue}.`);
      const [signal, check] = await Promise.all([
        getSignal(evidence.signalHash), verifySignal(evidence.signalHash, memo.payment_payer, evidence.receipt),
      ]);
      if (check.miner !== venue || check.intent !== marketIntent || !check.nodeVerified || !check.localHashMatch || check.error ||
        evidence.receipt?.intent !== marketIntent) {
        throw new Error(`Signal or finalized payment verification failed for ${venue}.`);
      }
      const payload = signal.payload;
      const response = payload?.response as { pair?: unknown; price?: unknown; venue?: unknown } | undefined;
      const observed = typeof payload?.timestamp === "string" ? Date.parse(payload.timestamp) : NaN;
      const cents = priceCents({ price_usd: response?.price });
      if (!payload || computeSignalHash(payload).toLowerCase() !== evidence.signalHash.toLowerCase() ||
        payload.request !== '[intent] CRYPTO_PRICE_USD \u2192 {"symbol":"SOL"}' || response?.pair !== "SOL-USD" ||
        response.venue !== venue.slice("crypto-".length) || !Number.isFinite(observed) || observed > at + 30_000 ||
        observed + maxAgeMs < at || cents === undefined ||
        priceCents(evidence.result) !== cents) {
        throw new Error(`The ${venue} SOL/USD signal expired or does not match the report.`);
      }
      return { cents, observed };
    }));
    const price = consensusPrice(quotes.map(q => q.cents));
    if (price === undefined) return { ok: false, error: "Independent SOL/USD prices differ by more than 1%." };
    if (memo.findings[0]?.facts?.priceCents !== price) return { ok: false, error: "The signed consensus price does not match the sources." };
    return { ok: true, price, validUntil: Math.min(...quotes.map(q => q.observed)) + maxAgeMs };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Market verification failed." };
  }
}

export async function buyMarket(): Promise<Memo> {
  const quotes = await Promise.all(venues.map(venue => quote(request, venue, true)));
  if (quotes.some(q => !q.ok || q.amountAtomic === undefined || q.amountAtomic < 1n || q.amountAtomic > paymentCeiling)) {
    throw new Error("Each source must quote at most 0.01 test USDC on Solana Devnet.");
  }
  const account = privateKeyToAccount(agentKey());
  const solana = await startupSolanaSigner();
  const evidence: Evidence[] = [];
  for (const [index, venue] of venues.entries()) {
    const budget = new Budget(0.01);
    const entry = {
      id: `sol-usd-${venue}`, checkId: "sol-usd", role: index === 0 ? "primary" : "crosscheck",
      intent: marketIntent, minerId: venue, at: new Date().toISOString(),
    } satisfies Omit<Evidence, "costUsd">;
    try {
      const { response, receipt, paidUsd } = await ask(request, { account, solana, budget, minerId: venue });
      evidence.push({
        ...entry, receipt, costUsd: paidUsd, minerName: response.miner_name,
        signalHash: response.signal_hash, durationMs: response.duration_ms, result: response.result,
      });
    } catch (error) {
      evidence.push({ ...entry, costUsd: budget.spentUsd, error: error instanceof Error ? error.message : "Telegraph request failed." });
      break;
    }
  }
  const cost = evidence.reduce((total, item) => total + item.costUsd, 0);
  const price = consensusPrice(evidence.map(source => priceCents(source.result) ?? 0));
  const timestamp = new Date().toISOString();
  return signMemo({
    memo_version: 1,
    id: `confidential-market-${timestamp.slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`,
    created_at: timestamp, pack: "confidential-market", mission: "Confidential Institutional Intelligence",
    subject: { name: "SOL/USD public market snapshot", fields: { symbol: "SOL", policy: policyId } },
    decision: "REVIEW", decision_label: "MARKET EVIDENCE", reasons: ["The private liquidity verdict is disclosed to the analyst."],
    findings: [{
      checkId: "sol-usd", title: "Independent SOL/USD quotes", why: "Use the lower price when both venues agree within 1%.",
      verdict: price === undefined ? "unknown" : "clear",
      summary: price === undefined ? "The source prices require review." : `Conservative price $${(price / 100).toFixed(2)}.`,
      facts: price === undefined ? undefined : { priceCents: price },
      critical: true, corroboration: price === undefined ? "disputed" : "confirmed", evidence: evidence.map(item => item.id),
    }],
    evidence, coverage: { total: 1, answered: price === undefined ? 0 : 1, unknown: price === undefined ? 1 : 0, skipped: 0 },
    cost: { total_usd: cost, paid_calls: evidence.filter(item => item.costUsd > 0).length, budget_usd: 0.02, per_finding_usd: cost },
    network: { node: config.node, chain: solanaDevnet, asset: solanaUsdc }, agent: account.address, payment_payer: solana.address,
  }, account);
}
