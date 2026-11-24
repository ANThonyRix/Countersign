import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { orderFromMemo, type SignedEvidenceReview } from "./policy.ts";
import type { FundingRequest } from "./solana.ts";
import type { Memo } from "../core/memo.ts";

const directory = () => path.join(config.dataDir, "settlements");
export const escrowPath = (memo: Memo) => path.join(directory(), orderFromMemo(memo).orderDigest + ".json");
function reviewPath(memo: Memo): string {
  if (!/^0x[a-f0-9]{64}$/.test(memo.digest)) throw new Error("Invalid memo digest.");
  return path.join(directory(), memo.digest + ".review.json");
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as T;
}

export function loadEscrow(memo: Memo): FundingRequest | undefined {
  const file = escrowPath(memo);
  return existsSync(file) ? readJson<FundingRequest>(file) : undefined;
}

export function loadEvidenceReview(memo: Memo): SignedEvidenceReview | undefined {
  const file = reviewPath(memo);
  return existsSync(file) ? readJson<SignedEvidenceReview>(file) : undefined;
}

export function saveFunding(memo: Memo, request: FundingRequest): string {
  mkdirSync(directory(), { recursive: true });
  const file = escrowPath(memo);
  writeFileSync(file, JSON.stringify(request, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return file;
}

export function saveEvidenceReview(memo: Memo, attestation: SignedEvidenceReview): void {
  mkdirSync(directory(), { recursive: true });
  writeFileSync(reviewPath(memo), JSON.stringify(attestation, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
