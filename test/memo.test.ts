import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signMemo, verifyMemoSignature, type MemoBody } from "../src/core/memo.ts";

const account = privateKeyToAccount(generatePrivateKey());

const body: MemoBody = {
  memo_version: 1,
  id: "test-memo",
  created_at: "2026-11-09T00:00:00.000Z",
  pack: "exchange",
  mission: "Exchange",
  subject: { name: "Example Token", fields: { project: "Example Token" } },
  decision: "GO",
  decision_label: "List",
  reasons: ["All 1 checks came back clean."],
  findings: [],
  evidence: [],
  coverage: { total: 1, answered: 1, unknown: 0, skipped: 0 },
  cost: { total_usd: 0.01, paid_calls: 1, budget_usd: 0.25, per_finding_usd: 0.01 },
  network: { node: "https://devnode.telegraphprotocol.com", chain: "eip155:11155111", asset: "USDC" },
  agent: account.address,
};

test("signed memo verifies and recovers the agent", async () => {
  const memo = await signMemo(body, account);
  const v = await verifyMemoSignature(memo);
  assert.equal(v.digestMatches, true);
  assert.equal(v.signerMatches, true);
  assert.equal(v.signer, account.address);
});

test("editing a signed memo breaks the digest", async () => {
  const memo = await signMemo(body, account);
  const v = await verifyMemoSignature({ ...memo, decision: "STOP" });
  assert.equal(v.digestMatches, false);
});

test("a memo signed by another wallet does not match its agent", async () => {
  const other = privateKeyToAccount(generatePrivateKey());
  const memo = await signMemo(body, other);
  const v = await verifyMemoSignature(memo);
  assert.equal(v.digestMatches, true);
  assert.equal(v.signerMatches, false);
});
