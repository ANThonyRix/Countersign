import { createHash } from "node:crypto";
import { isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { verifyMemoSignature, type Memo } from "../core/memo.ts";
import { decide } from "../core/policy.ts";
import { registrationKey } from "../core/evaluators.ts";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const shipmentChecks = ["order:booking", "order:shipment", "order:deadline"];
const hexHash = /^[a-f0-9]{64}$/;
const evmSignature = /^0x[a-f0-9]{130}$/i;

export interface OrderTerms {
  orderId: string;
  orderDigest: string;
  registration: string;
  buyer: string;
  supplier: string;
  settlementSigner: string;
  memoSigner: Address;
  reviewer: Address;
  amountAtomic: string;
}

export interface ReviewedEvidence {
  purchaseOrder: string;
  billOfLading: string;
  discharge: string;
  registry: string;
}

export interface EvidenceReview {
  version: 1;
  escrow: string;
  termsDigest: string;
  memoDigest: Hex;
  registration: string;
  evidence: ReviewedEvidence;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedEvidenceReview {
  review: EvidenceReview;
  signature: Hex;
}

export type Eligibility =
  | { status: "HOLD"; reasons: string[] }
  | { status: "READY"; memoDigest: Hex; reviewDigest: string };

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
      : item,
  );
}

export const termsDigest = (terms: OrderTerms) => sha256(canonical(["countersign:solana-devnet:escrow:v1", terms]));
export const reviewMessage = (review: EvidenceReview) => canonical(["countersign:solana-devnet:review:v1", review]);

export function orderFromMemo(memo: Memo) {
  if (memo.pack !== "commodities" || !memo.payment_conditions) throw new Error("A signed procurement memo is required.");
  const packet = JSON.parse(memo.subject.fields["order-packet"]);
  const order = packet?.purchaseOrder;
  if (typeof order?.id !== "string" || !order.id.trim() || typeof order.sellerRegistration !== "string") {
    throw new Error("The memo does not identify a purchase order and a supplier registration.");
  }
  const registration = registrationKey(order.sellerRegistration);
  if (!registration) throw new Error("The order's supplier registration is invalid.");
  return { orderId: order.id.trim(), orderDigest: sha256(canonical(order)), registration };
}

export async function signedForOrder(memo: Memo, terms: OrderTerms): Promise<boolean> {
  try {
    if (!isAddress(terms.memoSigner) || memo.agent.toLowerCase() !== terms.memoSigner.toLowerCase()) return false;
    const verified = await verifyMemoSignature(memo);
    if (!verified.digestMatches || !verified.signerMatches) return false;
    const order = orderFromMemo(memo);
    return order.orderId === terms.orderId && order.orderDigest === terms.orderDigest && order.registration === terms.registration;
  } catch {
    return false;
  }
}

export function validateEvidence(evidence: ReviewedEvidence): void {
  if (!["purchaseOrder", "billOfLading", "discharge", "registry"]
    .every((name) => typeof evidence?.[name as keyof ReviewedEvidence] === "string" && hexHash.test(evidence[name as keyof ReviewedEvidence]))) {
    throw new Error("Provide the SHA-256 hash of each reviewed original and the registry record.");
  }
}

export async function paymentEligibility(
  memo: Memo, terms: OrderTerms, escrow: string, attestation?: SignedEvidenceReview, now = Date.now(),
): Promise<Eligibility> {
  const hold = (...reasons: string[]): Eligibility => ({ status: "HOLD", reasons });
  if (!await signedForOrder(memo, terms)) return hold("The report signature or purchase order does not match this escrow.");
  if (memo.payment_conditions?.document_decision !== "PROCEED" ||
      !shipmentChecks.every((id) => memo.findings.some((finding) => finding.checkId === id && finding.verdict === "clear"))) {
    const failed = memo.findings.find((finding) => shipmentChecks.includes(finding.checkId) && finding.verdict !== "clear");
    return hold(failed?.summary ?? "The order, container and deadline must all pass shipment review.");
  }
  if (memo.payment_conditions.basis !== "supplied") {
    return hold("The shipment records are illustrative.", "Authenticated originals and supplier registry confirmation are required.");
  }
  if (memo.decision === "STOP") return hold("The signed report blocks payment.");
  const created = Date.parse(memo.created_at);
  if (!Number.isFinite(created) || created > now || now - created >= MAX_AGE_MS) return hold("A fresh signed review is required.");
  if (!attestation) return hold("Independent confirmation of original documents and the supplier registry is required.");

  const { review, signature } = attestation;
  if (!review || review.version !== 1 || review.escrow !== escrow || review.termsDigest !== termsDigest(terms) ||
      review.memoDigest !== memo.digest || review.registration !== terms.registration) {
    return hold("The evidence review does not match this escrow, order and report.");
  }
  const issued = Date.parse(review.issuedAt);
  const expires = Date.parse(review.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) ||
      issued < created || issued > now || expires <= now || expires - issued > MAX_AGE_MS) {
    return hold("The evidence review is expired or has invalid dates.");
  }
  try {
    validateEvidence(review.evidence);
    if (!evmSignature.test(signature) || !isAddress(terms.reviewer) ||
        terms.reviewer.toLowerCase() === terms.memoSigner.toLowerCase()) {
      return hold("An independent reviewer signature is required.");
    }
    const signer = await recoverMessageAddress({ message: reviewMessage(review), signature });
    if (signer.toLowerCase() !== terms.reviewer.toLowerCase()) return hold("The evidence review signer is not authorized.");
  } catch {
    return hold("The evidence review or signature is invalid.");
  }

  const originals = memo.findings.find((finding) => finding.checkId === "order:document-origin");
  const registry = memo.findings.filter((finding) => finding.checkId.startsWith("registry:"));
  if (!originals || registry.length !== 1) return hold("The report must record both document and supplier registry checks.");

  // The reviewer can resolve missing evidence. Adverse or disputed findings require a new report.
  const resolved = new Set([originals.checkId, registry[0].checkId]);
  const findings = memo.findings.map((finding) =>
    resolved.has(finding.checkId) && finding.verdict === "unknown" && finding.corroboration !== "disputed"
      ? { ...finding, verdict: "clear" as const, skipped: undefined }
      : finding,
  );
  const decision = decide(findings);
  if (decision.decision !== "GO") return hold(...decision.reasons);
  return { status: "READY", memoDigest: memo.digest, reviewDigest: sha256(canonical(attestation)) };
}
