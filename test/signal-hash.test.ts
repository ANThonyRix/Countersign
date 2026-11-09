import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSignalHash } from "../src/telegraph/client.ts";

// A real signal fetched from the devnode (GET /engine/v1/signal/{hash}).
const record = JSON.parse(readFileSync(new URL("./fixtures/signal.json", import.meta.url), "utf8"));

test("recomputes the node's signal hash from its payload", () => {
  assert.equal(computeSignalHash(record.payload), record.signal_hash);
});

test("any change to the payload changes the hash", () => {
  const tampered = { ...record.payload, wallet_address: "0x0000000000000000000000000000000000000001" };
  assert.notEqual(computeSignalHash(tampered), record.signal_hash);
});

test("wallet case and key order do not change the hash", () => {
  const reordered = Object.fromEntries(Object.entries(record.payload).reverse());
  if (typeof reordered.wallet_address === "string") reordered.wallet_address = reordered.wallet_address.toUpperCase().replace("0X", "0x");
  assert.equal(computeSignalHash(reordered), record.signal_hash);
});
