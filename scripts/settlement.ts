import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../src/config.ts";
import { loadMemo, type Memo } from "../src/core/memo.ts";
import { verifySignal } from "../src/telegraph/client.ts";
import {
  orderFromMemo, paymentEligibility, reviewMessage, signedForOrder, termsDigest, validateEvidence,
  type EvidenceReview, type OrderTerms, type ReviewedEvidence,
} from "../src/settlement/policy.ts";
import {
  amountAtomic, devnetConnection, findRelease, prepareFunding, releaseFunds, submitFunding, verifyFunding, verifyVault,
} from "../src/settlement/solana.ts";
import { loadEscrow, loadEvidenceReview, readJson, saveEvidenceReview, saveFunding } from "../src/settlement/storage.ts";

const DAY = 24 * 60 * 60 * 1000;
const explorer = (signature: string) => "https://explorer.solana.com/tx/" + signature + "?cluster=devnet";

function buyerKey(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(readJson<number[]>(file)));
}

function display(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function verifiedTelegraph(memo: Memo): Promise<boolean> {
  if (memo.network.node !== config.node) return false;
  const paid = memo.evidence.filter((row) => row.costUsd > 0);
  if (paid.length === 0 ||
      paid.some((row) => !row.signalHash || !row.receipt?.receipt_hash || row.error) ||
      new Set(paid.map((row) => row.minerId).filter(Boolean)).size < 2) return false;
  const checks = await Promise.all(paid.map((row) => verifySignal(row.signalHash!, memo.agent)));
  return checks.every((check) => check.found && check.nodeVerified && check.localHashMatch && !check.error);
}

async function main() {
  const [command, memoId, first, second, extra] = process.argv.slice(2);
  const requiredArgs: Record<string, number> = { fund: 4, status: 2, review: 4, release: 5 };
  if (!Object.hasOwn(requiredArgs, command) || process.argv.length - 2 !== requiredArgs[command] ||
      (command === "release" && extra !== "--approve")) {
    throw new Error([
      "Usage:",
      "  npm run settlement -- fund <memo-id> <terms.json> <buyer-key.json>",
      "  npm run settlement -- status <memo-id>",
      "  npm run settlement -- review <memo-id> <evidence-hashes.json> <reviewer-secp256k1-key-file>",
      "  npm run settlement -- release <memo-id> <buyer-key.json> <settlement-key.json> --approve",
    ].join("\n"));
  }
  const memo = loadMemo(memoId);
  if (!memo) throw new Error("Procurement memo not found.");
  const order = orderFromMemo(memo);
  const connection = devnetConnection();
  let request = loadEscrow(memo);

  if (command === "fund") {
    const input = readJson<Omit<OrderTerms, keyof typeof order>>(first);
    const terms: OrderTerms = {
      ...order,
      buyer: input.buyer, supplier: input.supplier, settlementSigner: input.settlementSigner,
      reviewer: input.reviewer, memoSigner: input.memoSigner, amountAtomic: input.amountAtomic,
    };
    if (!isAddress(terms.reviewer) || !isAddress(terms.memoSigner) ||
        terms.reviewer.toLowerCase() === terms.memoSigner.toLowerCase() || !await signedForOrder(memo, terms)) {
      throw new Error("Use a trusted signed order and a separate evidence reviewer.");
    }
    amountAtomic(terms.amountAtomic);
    const buyer = buyerKey(second);
    if (buyer.publicKey.toBase58() !== terms.buyer) throw new Error("The funding key must belong to the buyer.");
    if (request && termsDigest(request.escrow.terms) !== termsDigest(terms)) {
      throw new Error("An escrow with other terms already exists for this order.");
    }
    if (!request) {
      request = await prepareFunding(connection, terms, buyer);
      saveFunding(memo, request);
    }
    await submitFunding(connection, request);
    return display({ status: "FUNDED", vault: request.escrow.vault, funding: explorer(request.escrow.funding) });
  }

  if (!request || !await signedForOrder(memo, request.escrow.terms)) throw new Error("No escrow matches this signed order.");
  const { escrow } = request;
  if (command === "review") {
    if (memo.payment_conditions?.basis !== "supplied" || memo.payment_conditions.document_decision !== "PROCEED") {
      throw new Error("The signed shipment review must pass on supplied records.");
    }
    const evidence = readJson<ReviewedEvidence>(first);
    validateEvidence(evidence);
    const key = readFileSync(second, "utf8").trim();
    if (!/^0x[a-f0-9]{64}$/i.test(key)) throw new Error("Use a hex secp256k1 private key file for the independent reviewer.");
    const reviewer = privateKeyToAccount(key as Hex);
    if (reviewer.address.toLowerCase() !== escrow.terms.reviewer.toLowerCase()) throw new Error("The reviewer key is not authorized.");
    const now = Date.now();
    const review: EvidenceReview = {
      version: 1, escrow: escrow.vault, termsDigest: termsDigest(escrow.terms), memoDigest: memo.digest,
      registration: escrow.terms.registration, evidence,
      issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + DAY).toISOString(),
    };
    const signature = await reviewer.signMessage({ message: reviewMessage(review) });
    const attestation = { review, signature };
    const decision = await paymentEligibility(memo, escrow.terms, escrow.vault, attestation, now);
    if (decision.status !== "READY") return display(decision);
    saveEvidenceReview(memo, attestation);
    return display(decision);
  }

  await verifyFunding(connection, escrow);
  const existing = await findRelease(connection, escrow);
  if (existing) return display({ status: "RELEASED", ...existing, explorer: explorer(existing.signature) });
  await verifyVault(connection, escrow);
  const attestation = loadEvidenceReview(memo);
  const decision = await paymentEligibility(memo, escrow.terms, escrow.vault, attestation);
  if (command === "status" || decision.status === "HOLD") {
    return display({ ...decision, vault: escrow.vault, funding: explorer(escrow.funding) });
  }
  if (!await verifiedTelegraph(memo)) return display({ status: "HOLD", reasons: ["Paid Telegraph signals could not be verified with independent providers."] });
  const approval = await paymentEligibility(memo, escrow.terms, escrow.vault, attestation);
  if (approval.status !== "READY") return display(approval);
  const receipt = await releaseFunds(connection, escrow, approval, buyerKey(first), buyerKey(second));
  display({ status: "RELEASED", ...receipt, explorer: explorer(receipt.signature) });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
