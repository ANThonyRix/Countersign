import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Keep the test ledger away from the real data/spend.json. Set before config loads.
const dir = mkdtempSync(path.join(tmpdir(), "countersign-budget-"));
process.env.COUNTERSIGN_DATA_DIR = dir;
const { Budget, daySpend, usdToAtomic, atomicToUsd } = await import("../src/core/budget.ts");

const cent = usdToAtomic(0.01);

before(() => assert.equal(daySpend().spentUsd, 0));
after(() => rmSync(dir, { recursive: true, force: true }));

test("usd and atomic units round-trip", () => {
  assert.equal(cent, 10_000n);
  assert.equal(atomicToUsd(cent), 0.01);
});

test("run cap refuses the payment that would exceed it", () => {
  const b = new Budget(0.02, 10);
  assert.equal(b.reserve(cent), undefined);
  assert.equal(b.reserve(cent), undefined);
  assert.match(b.reserve(cent) ?? "", /run budget exhausted/);
});

test("released reservation frees budget and is not charged", () => {
  const b = new Budget(0.01, 10);
  assert.equal(b.reserve(cent), undefined);
  b.settle(cent, false);
  assert.equal(b.spentUsd, 0);
  assert.equal(b.calls, 0);
  assert.equal(b.reserve(cent), undefined);
});

test("charged payment counts toward run and day totals", () => {
  const b = new Budget(0.05, 10);
  b.reserve(cent);
  b.settle(cent, true);
  assert.equal(b.spentUsd, 0.01);
  assert.equal(b.calls, 1);
  assert.equal(b.remainingUsd, 0.04);
  assert.equal(daySpend().spentUsd, 0.01);
});

test("day cap holds across runs", () => {
  // The ledger already holds $0.01 from the previous test.
  const b = new Budget(1, 0.02);
  assert.equal(b.reserve(cent), undefined);
  assert.match(b.reserve(cent) ?? "", /daily budget exhausted/);
});
