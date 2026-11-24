import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, Transaction, type Connection } from "@solana/web3.js";
import { decodeCloseAccountInstruction, decodeTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { loadMemo, signMemo, type Memo } from "../src/core/memo.ts";
import {
  orderFromMemo, paymentEligibility, reviewMessage, sha256, termsDigest,
  type EvidenceReview, type OrderTerms,
} from "../src/settlement/policy.ts";
import { DEVNET_USDC, findRelease, fundingInstructions, releaseInstructions, type Escrow } from "../src/settlement/solana.ts";

const live = loadMemo("commodities-2026-11-24-8712c156")!;
const wrong = loadMemo("commodities-2026-11-23-3435f1fa")!;
const fundingRoles = { buyer: Keypair.generate(), supplier: Keypair.generate(), settlementSigner: Keypair.generate() };
const signer = privateKeyToAccount(generatePrivateKey());
const reviewer = privateKeyToAccount(generatePrivateKey());
const escrow = Keypair.generate().publicKey.toBase58();
const authority = Keypair.generate().publicKey.toBase58();
const now = Date.parse("2026-11-24T14:00:00Z");
const terms: OrderTerms = {
  ...orderFromMemo(live),
  buyer: fundingRoles.buyer.publicKey.toBase58(),
  supplier: fundingRoles.supplier.publicKey.toBase58(),
  settlementSigner: fundingRoles.settlementSigner.publicKey.toBase58(),
  memoSigner: signer.address, reviewer: reviewer.address, amountAtomic: "1000000",
};

async function suppliedMemo(edit?: (memo: Omit<Memo, "digest" | "signature">) => void): Promise<Memo> {
  const { digest, signature, ...body } = structuredClone(live);
  body.agent = signer.address;
  body.created_at = new Date(now - 1000).toISOString();
  body.payment_conditions = { basis: "supplied", document_decision: "PROCEED" };
  // Controlled test findings. A fresh real run must satisfy the gate on its own merits.
  body.findings = body.findings.map((finding) =>
    finding.verdict === "flag" && finding.checkId === "port:rotterdam" ? { ...finding, verdict: "clear" } : finding,
  );
  edit?.(body);
  return signMemo(body, signer);
}

async function evidenceReview(memo: Memo, edit?: (review: EvidenceReview) => void) {
  const review: EvidenceReview = {
    version: 1, escrow, termsDigest: termsDigest(terms), memoDigest: memo.digest,
    registration: terms.registration, issuedAt: new Date(now - 100).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
    evidence: {
      purchaseOrder: sha256("buyer original"),
      billOfLading: sha256("carrier original"),
      discharge: sha256("terminal original"),
      registry: sha256("supplier registry"),
    },
  };
  edit?.(review);
  return { review, signature: await reviewer.signMessage({ message: reviewMessage(review) }) };
}

test("both published examples remain on HOLD, including shipment PROCEED", async () => {
  for (const [memo, reason] of [[wrong, /TGHU1234572/], [live, /illustrative/]] as const) {
    const result = await paymentEligibility(memo, { ...terms, memoSigner: memo.agent as Address }, escrow);
    assert.equal(result.status, "HOLD");
    assert.match(result.reasons.join(" "), reason);
  }
});

test("supplier release requires independently signed originals and resolves only missing evidence", async () => {
  const memo = await suppliedMemo();
  assert.equal((await paymentEligibility(memo, terms, escrow, undefined, now)).status, "HOLD");
  const review = await evidenceReview(memo);
  const approved = await paymentEligibility(memo, terms, escrow, review, now);
  assert.equal(approved.status, "READY");
  assert.equal(approved.memoDigest, memo.digest);
  const blocked = await suppliedMemo((body) => {
    const registry = body.findings.find((finding) => finding.checkId.startsWith("registry:"))!;
    registry.corroboration = "disputed";
  });
  assert.equal((await paymentEligibility(blocked, terms, escrow, await evidenceReview(blocked), now)).status, "HOLD");
});

test("release rejects changed recipients, wrong escrow, an altered memo, and an expired review", async () => {
  const memo = await suppliedMemo();
  const review = await evidenceReview(memo);
  const newSupplier = { ...terms, supplier: Keypair.generate().publicKey.toBase58() };
  const editedMemo = { ...memo, reasons: [] };
  for (const result of await Promise.all([
    paymentEligibility(memo, newSupplier, escrow, review, now),
    paymentEligibility(memo, terms, authority, review, now),
    paymentEligibility(editedMemo, terms, escrow, review, now),
    paymentEligibility(memo, terms, escrow, review, now + 3600000),
  ])) assert.equal(result.status, "HOLD");
});

test("release pays the exact amount and closes the vault in one transaction requiring both signatures", async () => {
  const memo = await suppliedMemo();
  const approval = await paymentEligibility(memo, terms, escrow, await evidenceReview(memo), now);
  assert.equal(approval.status, "READY");
  const state: Escrow = { version: 1, terms, vault: escrow, authority, funding: "unused-in-instruction-test" };
  assert.equal(fundingInstructions(state, 3000000, 2000000).length, 6);
  const release = releaseInstructions(state, approval);
  const transfer = decodeTransferCheckedInstruction(release[1]);
  assert.equal(transfer.keys.mint.pubkey.toBase58(), DEVNET_USDC.toBase58());
  assert.equal(transfer.keys.destination.pubkey.toBase58(), getAssociatedTokenAddressSync(DEVNET_USDC, fundingRoles.supplier.publicKey).toBase58());
  assert.equal(transfer.data.amount, 1000000n);
  assert.equal(transfer.data.decimals, 6);
  assert.equal(decodeCloseAccountInstruction(release[2]).keys.account.pubkey.toBase58(), escrow);
  assert.match(release[3].data.toString("utf8"), new RegExp(memo.digest));

  const transaction = new Transaction({ feePayer: fundingRoles.buyer.publicKey, recentBlockhash: authority }).add(...release);
  transaction.partialSign(fundingRoles.buyer);
  assert.equal(transaction.verifySignatures(), false);
  transaction.partialSign(fundingRoles.settlementSigner);
  assert.equal(transaction.verifySignatures(), true);
});

test("finalized release verification rejects a transaction that only copies the report reference", async () => {
  const memo = await suppliedMemo();
  const approval = await paymentEligibility(memo, terms, escrow, await evidenceReview(memo), now);
  assert.equal(approval.status, "READY");
  const state: Escrow = { version: 1, terms, vault: escrow, authority, funding: "unused-in-receipt-test" };
  const instructions = releaseInstructions(state, approval);
  const memoText = instructions.at(-1)!.data.toString("utf8");
  const message = (transactionInstructions: typeof instructions) =>
    new Transaction({ feePayer: fundingRoles.buyer.publicKey, recentBlockhash: authority })
      .add(...transactionInstructions).compileMessage();
  const otherTerms = { ...terms, supplier: Keypair.generate().publicKey.toBase58() };
  const wrong = releaseInstructions({ ...state, terms: otherTerms }, approval);
  wrong[3] = instructions[3];
  const rpc = {
    getSignaturesForAddress: async () => [
      { signature: "wrong-transfer", memo: memoText, err: null },
      { signature: "authorized-transfer", memo: memoText, err: null },
    ],
    getTransaction: async (signature: string) => ({
      slot: 1, meta: { err: null },
      transaction: { message: message(signature === "wrong-transfer" ? wrong : instructions) },
    }),
  } as unknown as Connection;
  const receipt = await findRelease(rpc, state);
  assert.equal(receipt?.signature, "authorized-transfer");
  assert.equal(receipt.memoDigest, memo.digest);
});
