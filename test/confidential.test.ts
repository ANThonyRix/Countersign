import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Keypair, TransactionInstruction, TransactionMessage, type VersionedTransactionResponse } from "@solana/web3.js";
import { clusterOffset, parseAmounts, programId, queueContext, verifiedCiphertext } from "../src/confidential/compute.ts";
import { consensusPrice } from "../src/confidential/market.ts";
import { anchor, arcium } from "../src/confidential/sdk.ts";

const { BN } = anchor;
const { getClusterAccAddress, getComputationAccAddress } = arcium;

const discriminator = (label: string) => createHash("sha256").update(label).digest().subarray(0, 8);
const computation = getComputationAccAddress(clusterOffset, new BN(123));
const cluster = getClusterAccAddress(clusterOffset);
const other = Keypair.generate().publicKey;
const market = { price: 6_774, digest: "0x" + "ab".repeat(32) };

function transaction(accounts: typeof programId[], data: Buffer, logMessages: string[] = []) {
  return {
    blockTime: 1_795_612_900,
    meta: { fee: 5_000, err: null, logMessages },
    transaction: { message: new TransactionMessage({
      payerKey: other, recentBlockhash: other.toBase58(),
      instructions: [new TransactionInstruction({
        programId, data, keys: accounts.map(pubkey => ({ pubkey, isSigner: false, isWritable: false })),
      })],
    }).compileToV0Message() },
  } as unknown as VersionedTransactionResponse;
}

test("private amounts use exact subunits and reject values outside the circuit limits", () => {
  assert.deepEqual(parseAmounts(["10.001", "1000.59", "0.01"]), [10_001n, 100_059n, 1n]);
  assert.throws(() => parseAmounts(["0", "10", "0"]), /positive redemption/);
  assert.throws(() => parseAmounts(["0.0001", "10", "4"]), /decimal places/);
  assert.throws(() => parseAmounts(["1000000.001", "10", "4"]), /demo limits/);
});

test("quote consensus is conservative and fails closed on material disagreement", () => {
  assert.equal(consensusPrice([6_775, 6_774]), 6_774);
  assert.equal(consensusPrice([10_000, 10_100]), 10_000);
  assert.equal(consensusPrice([10_000, 10_101]), undefined);
  assert.equal(consensusPrice([6_775]), undefined);
});

test("the queue transaction binds the snapshot and the exact computation", () => {
  const data = Buffer.alloc(200);
  discriminator("global:check_liquidity").copy(data);
  data.writeBigUInt64LE(123n, 8);
  data.writeBigUInt64LE(BigInt(market.price), 160);
  Buffer.from(market.digest.slice(2), "hex").copy(data, 168);
  const accounts = Array.from({ length: 12 }, () => other);
  accounts[5] = computation;
  accounts[7] = cluster;
  const tx = transaction(accounts, data);
  assert.ok(queueContext(tx, market).computation.equals(computation));
  assert.throws(() => queueContext(tx, { ...market, price: 6_775 }), /not linked/);
  assert.throws(() => queueContext(tx, { ...market, digest: "0x" + "00".repeat(32) }), /not linked/);
});

test("only the program's verified callback event can supply the verdict ciphertext", () => {
  const data = Buffer.concat([discriminator("event:LiquidityComputed"), computation.toBuffer(), Buffer.alloc(48, 3)]);
  const accounts = [other, other, other, computation, cluster, other];
  const ix = discriminator("global:check_liquidity_callback");
  const event = `Program data: ${data.toString("base64")}`;
  const good = transaction(accounts, ix, [`Program ${programId} invoke [1]`, event, `Program ${programId} success`]);
  assert.deepEqual(verifiedCiphertext(good, computation).ciphertext, Buffer.alloc(32, 3));
  assert.throws(() => verifiedCiphertext(good, other), /different computation/);
  const spoof = transaction(accounts, ix, [`Program ${other} invoke [1]`, event, `Program ${other} success`]);
  assert.throws(() => verifiedCiphertext(spoof, computation), /no unique verified encrypted result/);
});
