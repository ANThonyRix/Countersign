import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../config.ts";
import type { Memo } from "../core/memo.ts";
import { paymentEligibility, signedForOrder } from "./policy.ts";
import type { Escrow } from "./solana.ts";
import { loadEscrow, loadEvidenceReview, readJson } from "./storage.ts";

const recordedProof = path.join(ROOT, "examples", "solana-devnet", "settlement-proof.json");

export async function settlementStatus(memo: Memo) {
  if (!memo.payment_conditions) return { status: "UNFUNDED" };
  const active = loadEscrow(memo);
  const recorded = !active && existsSync(recordedProof) ? readJson<{ escrow: Escrow }>(recordedProof) : undefined;
  const escrow = active?.escrow ?? recorded?.escrow;
  if (!escrow || !await signedForOrder(memo, escrow.terms)) return { status: "UNFUNDED" };
  const { devnetConnection, findRelease, verifyFunding, verifyVault } = await import("./solana.ts");
  const connection = devnetConnection();
  await verifyFunding(connection, escrow);
  const balance = { vault: escrow.vault, funding: escrow.funding, amountAtomic: escrow.terms.amountAtomic };
  const receipt = await findRelease(connection, escrow);
  if (receipt) {
    return receipt.memoDigest === memo.digest
      ? { status: "RELEASED", ...balance, ...receipt, supplier: escrow.terms.supplier }
      : { status: "SETTLED", ...balance, ...receipt };
  }
  if (recorded) throw new Error("The recorded release could not be reverified.");
  await verifyVault(connection, escrow);
  return { ...await paymentEligibility(memo, escrow.terms, escrow.vault, loadEvidenceReview(memo)), ...balance };
}
