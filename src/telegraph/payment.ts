import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import type { LocalAccount } from "viem/accounts";
import { config } from "../config.ts";

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
    if (payment.payTo.toLowerCase() !== config.diamond.toLowerCase()) {
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
