import { decodePaymentResponseHeader } from "@x402/fetch";
import { keccak256, toBytes } from "viem";
import type { LocalAccount } from "viem/accounts";
import { config, engineUrl } from "../config.ts";
import { Budget, atomicToUsd } from "../core/budget.ts";
import { createPaidFetch, type PaymentIntent } from "./payment.ts";
import {
  EngineError,
  type AskInput,
  type AskResponse,
  type IntentSchema,
  type MinerInfo,
  type PaymentQuote,
  type SignalRecord,
  type TelegraphReceipt,
} from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = { "user-agent": "countersign/0.1 (+telegraph hackathon s2)" };

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(config.requestTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function networkError(err: unknown, url: string, signed = false, amountAtomic = 0n): EngineError {
  const timedOut = (err as Error)?.name === "TimeoutError";
  const message = timedOut
    ? `Telegraph request timed out after ${config.requestTimeoutMs} ms at ${url}. Check TELEGRAPH_NODE and try again.`
    : `Cannot reach Telegraph node at ${url}. Check TELEGRAPH_NODE and try again. (${(err as Error)?.message ?? String(err)})`;
  return new EngineError(
    message + (signed ? " Payment was signed; settlement is unknown. The amount counts against the spend caps; inspect the wallet before retrying." : ""),
    0, timedOut ? "request_timeout" : "network_error", null, signed, amountAtomic,
  );
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function errorCode(body: unknown, status?: number): string {
  if (body && typeof body === "object" && "error" in body) return String((body as { error: unknown }).error);
  if (typeof body === "string" && body.trim() && !body.trimStart().startsWith("<")) return body.slice(0, 120);
  return status ? `http_${status}` : "unknown_error";
}

/** Gateway hiccups (Cloudflare 502/504 HTML pages) are safe to retry: nothing reached the engine. */
const isGatewayError = (status: number) => status === 502 || status === 504 || status === 520 || status === 522 || status === 524;

function decodeBase64Json<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

async function getJson<T>(url: string, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: requestSignal() });
      const body = await readBody(res);
      if (res.ok) return body as T;
      last = new EngineError(`GET ${url} -> ${res.status}`, res.status, errorCode(body, res.status), body, false);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      last = networkError(err, url);
      break;
    }
    await sleep(500 * 2 ** i);
  }
  throw last;
}

// ---------- discovery (free) ----------

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function getIntent(intentId: string): Promise<IntentSchema> {
  return cached(`intent:${intentId}`, 10 * 60_000, () => getJson<IntentSchema>(engineUrl(`/v1/intents/${intentId}`)));
}

export function listMiners(intentId: string): Promise<MinerInfo[]> {
  return cached(`miners:${intentId}`, 5 * 60_000, () =>
    getJson<MinerInfo[]>(`${config.node}/api/miners?intent=${encodeURIComponent(intentId)}&limit=200`),
  );
}

interface Leaderboard {
  epoch?: unknown;
  intents: Record<string, { miner_slug: string; score: number; rank: number; activation_status?: string }[]>;
}

export function leaderboard(): Promise<Leaderboard> {
  return cached("leaderboard", 5 * 60_000, () => getJson<Leaderboard>(`${config.node}/leaderboard/miners`));
}

/** Active miners for an intent, best leaderboard score first. Unranked miners go last. */
export async function rankedMiners(intentId: string): Promise<MinerInfo[]> {
  const [miners, board] = await Promise.all([listMiners(intentId), leaderboard().catch(() => ({ intents: {} }) as Leaderboard)]);
  const scores = new Map((board.intents[intentId] ?? []).map((row) => [row.miner_slug, row.score]));
  return miners
    .filter((m) => !m.activation_status || m.activation_status === "active")
    .sort((a, b) => (scores.get(b.slug) ?? -1) - (scores.get(a.slug) ?? -1));
}

export function getSignal(hash: string): Promise<SignalRecord> {
  return getJson<SignalRecord>(engineUrl(`/v1/signal/${hash}`));
}

// ---------- signal verification ----------

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Recomputes a signal hash the way the node commits to it: keccak256 over the compact,
 * key-sorted JSON payload with the wallet lowercased and HTML characters escaped
 * (Go's encoding/json default).
 */
export function computeSignalHash(payload: Record<string, unknown>): `0x${string}` {
  const p = { ...payload };
  if (typeof p.wallet_address === "string") p.wallet_address = p.wallet_address.toLowerCase();
  const json = JSON.stringify(sortKeys(p))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\u2028", "g"), "\\u2028")
    .replace(new RegExp("\u2029", "g"), "\\u2029");
  return keccak256(toBytes(json));
}

export interface SignalCheck {
  hash: string;
  found: boolean;
  nodeVerified: boolean;
  localHashMatch: boolean;
  payer?: string;
  miner?: string;
  intent?: string;
  error?: string;
}

export async function verifySignal(hash: string, expectedPayer?: string): Promise<SignalCheck> {
  try {
    const record = await getSignal(hash);
    const localHashMatch = record.payload ? computeSignalHash(record.payload).toLowerCase() === hash.toLowerCase() : false;
    const payer = record.signal?.wallet_address ?? (record.payload?.wallet_address as string | undefined);
    const check: SignalCheck = {
      hash,
      found: true,
      nodeVerified: record.verification?.verified === true,
      localHashMatch,
      payer,
      miner: record.signal?.miner_slug,
      intent: record.signal?.intent_id,
    };
    if (expectedPayer && payer && payer.toLowerCase() !== expectedPayer.toLowerCase()) {
      check.error = `signal was paid by ${payer}, expected ${expectedPayer}`;
    }
    return check;
  } catch (err) {
    return { hash, found: false, nodeVerified: false, localHashMatch: false, error: (err as Error).message };
  }
}

// ---------- quote (free) ----------

export interface QuoteResult {
  ok: boolean;
  amountAtomic?: bigint;
  priceUsd?: number;
  quote?: PaymentQuote;
  status: number;
  code?: string;
  problems?: unknown;
}

/**
 * Sends the request without a payment. The node validates params first, so a 400 here
 * costs nothing and a 402 tells the exact price that would be charged.
 */
export async function quote(input: AskInput, minerId?: string): Promise<QuoteResult> {
  const url = engineUrl(minerId ? `/v1/ask/${encodeURIComponent(minerId)}` : "/v1/ask");
  let res: Response | undefined;
  let body: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, { method: "POST", headers: { ...UA, "content-type": "application/json" }, body: JSON.stringify(input), signal: requestSignal() });
      body = await readBody(res);
    } catch (err) {
      throw networkError(err, url);
    }
    if (!isGatewayError(res.status) && res.status !== 429) break;
    await sleep(800 * 2 ** attempt);
  }
  if (!res) return { ok: false, status: 0, code: "network_error" };
  if (res.status === 402) {
    const challenge = decodeBase64Json<{ accepts?: PaymentQuote[] }>(res.headers.get("payment-required"));
    const exact = challenge?.accepts?.find((a) => a.scheme === "exact" && a.network === config.network);
    if (!exact) return { ok: false, status: 402, code: "no_exact_scheme" };
    const amountAtomic = BigInt(exact.amount);
    return { ok: true, status: 402, amountAtomic, priceUsd: atomicToUsd(amountAtomic), quote: exact };
  }
  const problems = body && typeof body === "object" && "problems" in body ? (body as { problems: unknown }).problems : undefined;
  return { ok: false, status: res.status, code: errorCode(body, res.status), problems };
}

// ---------- paid ask ----------

export interface AskOutcome {
  response: AskResponse;
  receipt?: TelegraphReceipt;
  settlement?: unknown;
  paidAtomic: bigint;
  paidUsd: number;
  minerId?: string;
  httpStatus: number;
  attempts: number;
}

export interface AskOptions {
  account: LocalAccount;
  budget: Budget;
  /** Direct ask: skip routing and call this miner (id or slug). No fallback on the node. */
  minerId?: string;
  acknowledgeWarnings?: boolean;
  signal?: AbortSignal;
}

export async function ask(input: AskInput, opts: AskOptions): Promise<AskOutcome> {
  const url = engineUrl(opts.minerId ? `/v1/ask/${encodeURIComponent(opts.minerId)}` : "/v1/ask");
  const body = opts.acknowledgeWarnings ? { ...input, acknowledge_warnings: true } : input;

  for (let attempt = 1; attempt <= 4; attempt++) {
    let signed: PaymentIntent | undefined;
    let reserved: bigint | undefined;
    const paidFetch = createPaidFetch(
      opts.account,
      (p) => {
        const refusal = opts.budget.reserve(p.amountAtomic);
        if (refusal) return refusal;
        reserved = p.amountAtomic;
      },
      (p) => {
        signed = p;
      },
    );

    let res: Response;
    let payload: unknown;
    try {
      res = await paidFetch(url, {
        method: "POST",
        headers: { ...UA, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: requestSignal(opts.signal),
      });
      payload = await readBody(res);
    } catch (err) {
      // A disconnected response after signing cannot prove that settlement failed.
      if (reserved !== undefined) opts.budget.settle(reserved, signed !== undefined);
      const message = (err as Error).message ?? String(err);
      const refused = /budget exhausted|refusing to pay|unexpected (payTo|asset)|rejected by spendControls/i.test(message);
      if (refused) throw new EngineError(message, 0, "payment_refused", null, false);
      throw networkError(err, url, signed !== undefined, signed?.amountAtomic);
    }

    const ok = res.status >= 200 && res.status < 300;
    // Payment settles only when the ask succeeds; engine errors are released from the budget.
    // A gateway timeout after signing is ambiguous, so it is counted as spent (conservative).
    if (reserved !== undefined) opts.budget.settle(reserved, (ok || isGatewayError(res.status)) && signed !== undefined);

    if (ok) {
      const paidAtomic = signed?.amountAtomic ?? 0n;
      const paymentHeader = res.headers.get("payment-response");
      let settlement: unknown;
      try {
        settlement = paymentHeader ? decodePaymentResponseHeader(paymentHeader) : undefined;
      } catch {
        settlement = undefined;
      }
      const response = payload as AskResponse;
      return {
        response,
        receipt: decodeBase64Json<TelegraphReceipt>(res.headers.get("x-telegraph-receipt")),
        settlement,
        paidAtomic,
        paidUsd: atomicToUsd(paidAtomic),
        minerId: response.miner_id ?? opts.minerId,
        httpStatus: res.status,
        attempts: attempt,
      };
    }

    const code = errorCode(payload, res.status);
    const retryable =
      res.status === 429 ||
      (isGatewayError(res.status) && !signed) ||
      (res.status === 503 && /extraction_unavailable|could not route/i.test(code));
    if (retryable && attempt < 4) {
      await sleep(1500 * 2 ** (attempt - 1));
      continue;
    }
    throw new EngineError(
      `${res.status} ${code}${signed && isGatewayError(res.status) ? " (payment was signed; settlement unknown, counted against spend caps)" : signed ? " (payment was signed; not settled on failure)" : ""}`,
      res.status,
      code,
      payload,
      !!signed && isGatewayError(res.status),
      signed?.amountAtomic,
    );
  }
  throw new EngineError("retries exhausted", 0, "retries_exhausted", null, false);
}
