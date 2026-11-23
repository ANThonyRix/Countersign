import { randomUUID } from "node:crypto";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import type { LocalAccount } from "viem/accounts";
import { config } from "../config.ts";
import type { PaymentQuote } from "./types.ts";

export interface PaymentIntent {
  amountAtomic: bigint;
  payTo: string;
  asset: string;
  network: string;
}

/**
 * Called right before a payment is signed. Throw or return a reason string to refuse.
 * This is where the budget guard lives: the agent never signs past its caps.
 */
export type PaymentGuard = (payment: PaymentIntent) => Promise<string | void> | string | void;

/**
 * Returns a fetch that answers x402 challenges by signing an EIP-3009 USDC authorization
 * on Sepolia. A new client per call keeps the guard bound to exactly one request.
 */
export function createPaidFetch(account: LocalAccount, guard: PaymentGuard, onSigned?: (p: PaymentIntent) => void): typeof fetch {
  const client = x402Client.fromConfig({
    schemes: [{ network: config.network, client: new ExactEvmScheme(account) }],
    spendControls: {
      maxAmountPerPayment: false,
      allowedAssets: [{ network: config.network, asset: config.usdc, maxAmountPerPayment: config.maxAtomicPerPayment }],
    },
  });

  client.onBeforePaymentCreation(async ({ selectedRequirements: req }) => {
    const payment: PaymentIntent = {
      amountAtomic: BigInt(req.amount),
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
    };
    if (payment.payTo.toLowerCase() !== config.exactPayTo.toLowerCase()) {
      return { abort: true, reason: `unexpected payTo ${payment.payTo}; refusing to pay an unknown address` };
    }
    if (payment.asset.toLowerCase() !== config.usdc.toLowerCase()) {
      return { abort: true, reason: `unexpected asset ${payment.asset}` };
    }
    const refusal = await guard(payment);
    if (refusal) return { abort: true, reason: refusal };
  });

  client.onAfterPaymentCreation(async ({ selectedRequirements: req }) => {
    onSigned?.({ amountAtomic: BigInt(req.amount), payTo: req.payTo, asset: req.asset, network: req.network });
  });

  return wrapFetchWithPayment(fetch, client) as typeof fetch;
}

export function escrowAmount(quote: PaymentQuote, url: string): bigint | undefined {
  const receiver = config.diamond.toLowerCase();
  const resource = new URL(url).pathname.replace(/^\/engine(?=\/)/, "");
  const amount = quote.extra?.message?.match(/^Amount: ([1-9][0-9]{0,17}) uUSDC$/m)?.[1];
  if (quote.scheme !== "escrow" || quote.network !== config.network || quote.payTo?.toLowerCase() !== receiver || !amount) return;
  if (quote.amount !== undefined && quote.amount !== amount) return;
  if (quote.extra?.resource !== resource) return;
  const expected = [
    "Telegraph Escrow Payment", "", "Wallet: {from}", `Pay To: ${receiver}`,
    `Network: ${config.network}`, `Amount: ${amount} uUSDC`, `Resource: ${resource}`,
    "Nonce: {nonce}", "Valid After: {validAfter}", "Valid Before: {validBefore}",
  ].join("\n");
  if (quote.extra.message !== expected) return;
  return BigInt(amount);
}

export async function escrowHeader(account: LocalAccount, quote: PaymentQuote, amount: bigint): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address.toLowerCase(),
    to: config.diamond.toLowerCase(),
    value: String(amount),
    validAfter: String(now - 10),
    validBefore: String(now + 90),
    nonce: randomUUID(),
  };
  const message = quote.extra!.message!.replace(/\{(from|validAfter|validBefore|nonce)\}/g, (_, key: "from" | "validAfter" | "validBefore" | "nonce") => authorization[key]);
  const signature = await account.signMessage({ message });
  return Buffer.from(JSON.stringify({
    x402Version: 2, scheme: "escrow", network: config.network, payload: { signature, authorization },
  })).toString("base64");
}
