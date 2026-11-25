import { BN, AnchorProvider } from "@anchor-lang/core";
import {
  awaitComputationFinalization, deserializeLE, getArciumProgramId, getArciumSignerAccAddress,
  getClockAccAddress, getClusterAccAddress, getCompDefAccAddress, getCompDefAccOffset,
  getComputationAccAddress, getExecutingPoolAccAddress, getFeePoolAccAddress,
  getMempoolAccAddress, getMXEAccAddress, getMXEPublicKey, RescueCipher, sha256, x25519,
} from "@arcium-hq/client";
import {
  Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, type VersionedTransactionResponse,
} from "@solana/web3.js";
import { Buffer } from "buffer";

export const programId = new PublicKey("EbFG12L4EqbuCqKkhf3hbThgXz43wXAAXr3psBQGPoAz");
export const clusterOffset = 456;
export const rpcUrl = "https://api.devnet.solana.com";
const arciumProgram = getArciumProgramId();
const cluster = getClusterAccAddress(clusterOffset);
const mxe = getMXEAccAddress(programId);
export const definition = getCompDefAccAddress(programId, Buffer.from(getCompDefAccOffset("check_liquidity")).readUInt32LE());
const tag = (name: string) => sha256([new TextEncoder().encode(name)]).subarray(0, 8);
const queueTag = tag("global:check_liquidity");
const callbackTag = tag("global:check_liquidity_callback");
const eventTag = tag("event:LiquidityComputed");

export interface MarketReference { price: number; digest: string }
export interface ComputeReference { queue: string; callback: string }
export type Amounts = [solMilli: bigint, reserveCents: bigint, redemptionCents: bigint];
const maxAmount = 1_000_000_000n;

export function parseAmounts(values: string[]): Amounts {
  if (values.length !== 3) throw new Error("Enter a position, a cash reserve and a redemption.");
  const amounts = values.map((value, index) => {
    const decimals = index === 0 ? 3 : 2;
    const input = value.trim();
    if (!new RegExp(`^\\d{1,8}(?:\\.\\d{1,${decimals}})?$`).test(input)) throw new Error(`Use up to ${decimals} decimal places.`);
    const [whole, fraction = ""] = input.split(".");
    const atomic = BigInt(whole + fraction.padEnd(decimals, "0"));
    if (atomic > maxAmount || (index === 2 && atomic === 0n)) throw new Error("Enter amounts within the demo limits and a positive redemption.");
    return atomic;
  });
  return [amounts[0], amounts[1], amounts[2]];
}

function queueInstruction(payer: PublicKey, computation: PublicKey, offset: BN, encrypted: number[][],
  key: Uint8Array, nonce: Uint8Array, market: MarketReference) {
  const body = Buffer.alloc(200);
  queueTag.copy(body, 0);
  body.set(offset.toArray("le", 8), 8);
  encrypted.forEach((part, index) => body.set(part, 16 + 32 * index));
  body.set(key, 112);
  body.set(nonce, 144);
  body.writeBigUInt64LE(BigInt(market.price), 160);
  body.set(Buffer.from(market.digest.slice(2), "hex"), 168);
  return new TransactionInstruction({ programId, data: body, keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: getArciumSignerAccAddress(programId), isSigner: false, isWritable: true },
    { pubkey: mxe, isSigner: false, isWritable: false },
    { pubkey: getMempoolAccAddress(clusterOffset), isSigner: false, isWritable: true },
    { pubkey: getExecutingPoolAccAddress(clusterOffset), isSigner: false, isWritable: true },
    { pubkey: computation, isSigner: false, isWritable: true },
    { pubkey: definition, isSigner: false, isWritable: false },
    { pubkey: cluster, isSigner: false, isWritable: true },
    { pubkey: getFeePoolAccAddress(), isSigner: false, isWritable: true },
    { pubkey: getClockAccAddress(), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: arciumProgram, isSigner: false, isWritable: false },
  ] });
}

function resolveMessage(tx: VersionedTransactionResponse) {
  return tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
}

export function queueContext(tx: VersionedTransactionResponse | null, market: MarketReference) {
  if (!tx?.meta || tx.meta.err || !tx.blockTime) throw new Error("The queue transaction is not finalized successfully.");
  const keys = resolveMessage(tx);
  const matches = tx.transaction.message.compiledInstructions.filter(ix =>
    keys.get(ix.programIdIndex)?.equals(programId) && Buffer.from(ix.data.subarray(0, 8)).equals(queueTag));
  const ix = matches[0];
  if (matches.length !== 1 || ix.data.length !== 200 || ix.accountKeyIndexes.length !== 12) throw new Error("Invalid liquidity instruction.");
  const data = Buffer.from(ix.data);
  if (data.readBigUInt64LE(160) !== BigInt(market.price) || `0x${data.subarray(168).toString("hex")}` !== market.digest) {
    throw new Error("The computation is not linked to this price and market report.");
  }
  const offset = new BN(data.subarray(8, 16), "le");
  const computation = getComputationAccAddress(clusterOffset, offset);
  if (!keys.get(ix.accountKeyIndexes[5])?.equals(computation) || !keys.get(ix.accountKeyIndexes[7])?.equals(cluster)) {
    throw new Error("The instruction references a different computation or cluster.");
  }
  return { computation, blockTime: tx.blockTime * 1_000, fee: tx.meta.fee };
}

export function verifiedCiphertext(tx: VersionedTransactionResponse | null, computation: PublicKey) {
  if (!tx?.meta || tx.meta.err) throw new Error("The Arcium callback is not finalized successfully.");
  const keys = resolveMessage(tx);
  const matches = tx.transaction.message.compiledInstructions.filter(ix =>
    keys.get(ix.programIdIndex)?.equals(programId) && Buffer.from(ix.data.subarray(0, 8)).equals(callbackTag) &&
    keys.get(ix.accountKeyIndexes[3])?.equals(computation) && keys.get(ix.accountKeyIndexes[4])?.equals(cluster));
  if (matches.length !== 1) throw new Error("The callback belongs to a different computation.");

  // Anchor logs are public. Track invocation depth so another program cannot spoof the event.
  const stack: string[] = [];
  const output: Buffer[] = [];
  for (const line of tx.meta.logMessages ?? []) {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) { stack.length = Number(invoke[2]) - 1; stack.push(invoke[1]); continue; }
    if (/^Program \w+ (?:success|failed:)/.test(line)) { stack.pop(); continue; }
    if (stack.at(-1) !== programId.toBase58() || !line.startsWith("Program data: ")) continue;
    const data = Buffer.from(line.slice(14), "base64");
    if (data.length === 88 && data.subarray(0, 8).equals(eventTag) && data.subarray(8, 40).equals(Buffer.from(computation.toBytes()))) {
      output.push(data);
    }
  }
  if (output.length !== 1) throw new Error("The callback has no unique verified encrypted result.");
  return { ciphertext: output[0].subarray(40, 72), nonce: output[0].subarray(72), fee: tx.meta.fee };
}

const finalized = { commitment: "finalized" as const, maxSupportedTransactionVersion: 0 };

export async function inspectComputation(connection: Connection, reference: ComputeReference, market: MarketReference) {
  const [queue, callback] = await Promise.all([
    connection.getTransaction(reference.queue, finalized), connection.getTransaction(reference.callback, finalized),
  ]);
  const context = queueContext(queue, market);
  if (callback && queue && callback.slot < queue.slot) throw new Error("The callback predates the queue instruction.");
  return { ...verifiedCiphertext(callback, context.computation), context };
}

async function resolveCallback(connection: Connection, computation: PublicKey, queue: string, latest: string) {
  const transaction = await connection.getTransaction(latest, finalized);
  if (latest !== queue && transaction?.meta && !transaction.meta.err) {
    return { callback: latest, ...verifiedCiphertext(transaction, computation) };
  }

  // Multiple nodes may submit the callback. Only the first successful transaction carries a verified result.
  const history = await connection.getSignaturesForAddress(computation, { limit: 20 }, "finalized");
  for (const item of history) {
    if (item.err || item.signature === queue || item.signature === latest) continue;
    const candidate = await connection.getTransaction(item.signature, finalized);
    if (candidate?.meta && !candidate.meta.err) {
      return { callback: item.signature, ...verifiedCiphertext(candidate, computation) };
    }
  }
  throw new Error("The computation has no successful, finalized Arcium callback.");
}

export async function calculate(
  provider: AnchorProvider, amounts: Amounts, market: MarketReference,
  onQueued: (signature: string) => void = () => {},
) {
  if (!/^0x[a-f0-9]{64}$/.test(market.digest) || !Number.isSafeInteger(market.price) || market.price < 1 || market.price > 10_000_000) {
    throw new Error("A verified market reference is required.");
  }
  const mxeKey = await getMXEPublicKey(provider, programId);
  if (!mxeKey) throw new Error("The Arcium cluster key is unavailable.");
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const secret = x25519.getSharedSecret(privateKey, mxeKey);
  try {
    const cipher = new RescueCipher(secret);
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const offset = new BN(deserializeLE(crypto.getRandomValues(new Uint8Array(8))).toString());
    const computation = getComputationAccAddress(clusterOffset, offset);
    const instruction = queueInstruction(provider.publicKey, computation, offset, cipher.encrypt(amounts, nonce), publicKey, nonce, market);
    const queue = await provider.sendAndConfirm(new Transaction().add(instruction), [], { commitment: "finalized" });
    onQueued(queue);
    const latest = await awaitComputationFinalization(provider, offset, programId, "finalized", 180_000);
    const context = queueContext(await provider.connection.getTransaction(queue, finalized), market);
    const result = await resolveCallback(provider.connection, computation, queue, latest);
    const [verdict] = cipher.decrypt([[...result.ciphertext]], result.nonce);
    if (verdict !== 0n && verdict !== 1n) throw new Error("Encrypted inputs are outside the policy limits.");
    return { queue, callback: result.callback, verdict: verdict === 1n ? "COVERED" : "REVIEW", feesLamports: result.fee + context.fee };
  } finally {
    privateKey.fill(0);
    secret.fill(0);
  }
}
