import { readFileSync } from "node:fs";
import type { createKeyPairSignerFromBytes } from "@solana/kit";
import { config } from "../config.ts";
import type { TelegraphReceipt } from "./types.ts";

export const solanaDevnet = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const solanaPayTo = "G53EbeTZSNsAn7bj6iMFUQnq3zpDdEbHhKkPRywo8bix";
export const solanaUsdc = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export type SolanaPaymentSigner = Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;

export function usesStartupSolana(pack: string): boolean {
  return pack === "startup" && !!config.startupSolanaKeypairFile;
}

export async function startupSolanaSigner(): Promise<SolanaPaymentSigner> {
  const secret = JSON.parse(readFileSync(config.startupSolanaKeypairFile!, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(secret) || secret.length !== 64 || secret.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("Provide a Solana Devnet JSON keypair file for Startup.");
  }
  const kit = await import("@solana/kit");
  return kit.createKeyPairSignerFromBytes(Uint8Array.from(secret));
}

export async function startupSolanaWallet(signer: SolanaPaymentSigner) {
  const [{ getAssociatedTokenAddressSync }, { PublicKey }, { DEVNET_USDC, devnetConnection }] = await Promise.all([
    import("@solana/spl-token"), import("@solana/web3.js"), import("../settlement/solana.ts"),
  ]);
  const account = getAssociatedTokenAddressSync(DEVNET_USDC, new PublicKey(signer.address));
  const rpc = devnetConnection();
  const balance = await rpc.getAccountInfo(account) ? await rpc.getTokenAccountBalance(account) : undefined;
  return {
    address: signer.address,
    usdc: balance?.value.uiAmountString ?? "0",
    explorer: `https://explorer.solana.com/address/${signer.address}?cluster=devnet`,
  };
}

export async function verifySolanaPayment(receipt: TelegraphReceipt | undefined, payer: string, signalTransaction?: string): Promise<boolean> {
  if (!receipt || receipt.chain !== solanaDevnet || receipt.rail !== "x402" || receipt.payer !== payer ||
      !receipt.tx_hash || receipt.tx_hash !== signalTransaction || !/^[1-9]\d{0,18}$/.test(String(receipt.amount_uusdc))) {
    return false;
  }
  const amount = BigInt(receipt.amount_uusdc!);
  if (amount >= 1n << 64n) return false;
  const [{ createTransferCheckedInstruction, getAssociatedTokenAddressSync }, { PublicKey }, { DEVNET_USDC, devnetConnection, hasInstruction }] =
    await Promise.all([import("@solana/spl-token"), import("@solana/web3.js"), import("../settlement/solana.ts")]);
  const authority = new PublicKey(payer);
  const source = getAssociatedTokenAddressSync(DEVNET_USDC, authority);
  const destination = getAssociatedTokenAddressSync(DEVNET_USDC, new PublicKey(solanaPayTo));
  const instruction = createTransferCheckedInstruction(source, DEVNET_USDC, destination, authority, amount, 6);
  const tx = await devnetConnection().getTransaction(receipt.tx_hash, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  return !!tx?.meta && !tx.meta.err && hasInstruction(tx, instruction);
}
