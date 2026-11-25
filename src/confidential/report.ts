import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { config, agentKey } from "../config.ts";
import { loadMemo, saveMemo, signMemo, type Memo } from "../core/memo.ts";
import { devnetConnection } from "../settlement/solana.ts";
import { inspectComputation, type ComputeReference } from "./compute.ts";
import { policyId, verifyMarket } from "./market.ts";

const snapshotFile = () => path.join(config.dataDir, "confidential-market.json");

export function updateMarket(memo: Memo) {
  saveMemo(memo);
  mkdirSync(config.dataDir, { recursive: true });
  const file = snapshotFile();
  const temporary = `${file}.${crypto.randomUUID()}`;
  writeFileSync(temporary, JSON.stringify(memo), { flag: "wx" });
  renameSync(temporary, file);
}

export async function publicMarket() {
  if (!existsSync(snapshotFile())) return { ok: false, error: "A fresh paid market snapshot is required." };
  const memo = JSON.parse(readFileSync(snapshotFile(), "utf8")) as Memo;
  const status = await verifyMarket(memo);
  return { ...status, id: memo.id, digest: memo.digest, cost: memo.cost.total_usd };
}

function verifyReference(reference: ComputeReference) {
  if (![reference.queue, reference.callback].every(value => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(value)) ||
    reference.queue === reference.callback) throw new Error("Provide two different Devnet transaction signatures.");
}

async function verifiedExecution(market: Memo, reference: ComputeReference) {
  verifyReference(reference);
  const price = market.findings[0]?.facts?.priceCents;
  if (market.pack !== "confidential-market" || typeof price !== "number" || !Number.isSafeInteger(price) || price < 1) {
    throw new Error("The public market report does not include a consensus price.");
  }
  const result = await inspectComputation(devnetConnection(), reference, { price, digest: market.digest });
  const asOf = result.context.blockTime;
  const status = await verifyMarket(market, asOf);
  if (!status.ok || price !== status.price) throw new Error(status.error ?? "Public price verification failed.");
  return {
    asOf,
    proof: {
      marketId: market.id, marketDigest: market.digest, priceCents: price, policy: policyId,
      queue: reference.queue, callback: reference.callback, feesLamports: result.context.fee + result.fee,
    },
  };
}

export async function createExecutionReport(marketId: string, reference: ComputeReference): Promise<Memo> {
  if (!/^confidential-market-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/.test(marketId)) throw new Error("Invalid market report ID.");
  const market = loadMemo(marketId);
  if (!market) throw new Error("Market report is missing.");
  const { asOf, proof } = await verifiedExecution(market, reference);
  const account = privateKeyToAccount(agentKey());
  const id = `confidential-${createHash("sha256").update(reference.queue).digest("hex").slice(0, 32)}`;
  const memo = await signMemo({
    memo_version: 1, id, created_at: new Date(asOf).toISOString(), pack: "confidential",
    mission: "Confidential Institutional Intelligence",
    subject: { name: "Private liquidity check", fields: { policy: policyId, market: market.id } },
    decision: "REVIEW", decision_label: "PRIVATE DECISION",
    reasons: ["The Arcium callback validated the cluster signature. The analyst can decrypt the verdict locally."],
    confidential_execution: proof,
    findings: market.findings, evidence: market.evidence, coverage: market.coverage, cost: market.cost,
    network: market.network, agent: account.address, payment_payer: market.payment_payer,
  }, account);
  saveMemo(memo);
  return memo;
}

export async function verifyExecutionReport(memo: Memo) {
  const proof = memo.confidential_execution;
  try {
    const market = proof && loadMemo(proof.marketId);
    if (memo.pack !== "confidential" || !market || market.digest !== proof?.marketDigest) throw new Error("Market report is missing or changed.");
    const run = await verifiedExecution(market, { queue: proof.queue, callback: proof.callback });
    if (run.proof.priceCents !== proof.priceCents || run.proof.policy !== proof.policy || run.proof.feesLamports !== proof.feesLamports) {
      throw new Error("The signed execution details do not match Devnet.");
    }
    return { status: "finalized", ...run.proof };
  } catch (error) {
    return { status: "unverified", error: error instanceof Error ? error.message : "Arcium execution verification failed." };
  }
}
