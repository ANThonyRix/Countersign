export type FieldStatus = "ok" | "missing" | "rejected" | "unavailable";

/** Body of a successful POST /engine/v1/ask (both routed and direct). */
export interface AskResponse {
  miner_id?: string;
  miner_name?: string;
  endpoint?: string;
  result: unknown;
  result_shape?: "intent" | "raw";
  shape_error?: string;
  format_version?: string;
  field_status?: Record<string, FieldStatus>;
  input?: unknown;
  cost_usd?: number;
  duration_ms?: number;
  reasoning?: string;
  intent?: string;
  signal_hash?: string;
  warnings?: string[];
}

/** Decoded X-TELEGRAPH-RECEIPT header. */
export interface TelegraphReceipt {
  receipt_hash: string;
  rail?: string;
  payer?: string;
  miner?: string | number;
  intent?: string;
  amount_uusdc?: number | string;
  epoch_id?: number | string;
  settlement?: string;
  chain?: string;
  tx_hash?: string;
  timestamp?: string;
}

export interface PaymentQuote {
  scheme: string;
  network: string;
  asset?: string;
  amount: string;
  payTo: string;
}

export interface MinerInfo {
  id: string;
  slug: string;
  name: string;
  kind?: string;
  protocol?: string;
  description?: string;
  supported_intents?: string[];
  activation_status?: string;
  min_price_usdc?: number;
}

export interface IntentSchema {
  intent_id: string;
  class?: string;
  miner_count?: number;
  request?: { params?: { name: string; type?: string; required?: boolean }[] };
  response?: { fields?: { name: string; type?: string; scored?: boolean }[] };
}

export interface SignalRecord {
  signal_hash: string;
  kind?: string;
  signal?: { wallet_address?: string; miner_slug?: string; intent_id?: string; tx_hash?: string; created_at?: string };
  payload?: Record<string, unknown>;
  verification?: { algorithm?: string; commitment?: string; verified?: boolean };
}

/** Engine error. `paid` also includes signed payments whose settlement is unknown. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
    readonly paid: boolean,
    readonly amountAtomic: bigint = 0n,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export type AskInput =
  | { intent: string; params: Record<string, unknown> }
  | { query: string }
  /** Direct ask on a miner for an intent with no input schema: the query completes the request. */
  | { intent: string; query: string };
