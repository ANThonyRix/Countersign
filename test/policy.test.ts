import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/core/policy.ts";
import type { Finding } from "../src/core/types.ts";

const f = (over: Partial<Finding>): Finding => ({
  checkId: over.checkId ?? "c",
  title: over.title ?? "Check",
  why: "",
  verdict: "clear",
  summary: over.summary ?? "summary",
  critical: false,
  corroboration: "single",
  evidence: [],
  ...over,
});

test("all clean checks give GO", () => {
  const r = decide([f({}), f({}), f({ critical: true, corroboration: "confirmed" })]);
  assert.equal(r.decision, "GO");
  assert.deepEqual(r.reasons, ["All 3 checks came back clean."]);
  assert.deepEqual(r.coverage, { total: 3, answered: 3, unknown: 0, skipped: 0 });
});

test("confirmed critical block gives STOP", () => {
  const r = decide([f({}), f({ verdict: "block", critical: true, corroboration: "confirmed", summary: "Sanctions hit" })]);
  assert.equal(r.decision, "STOP");
  assert.ok(r.reasons.includes("Sanctions hit"));
});

test("non-critical block gives STOP without a second miner", () => {
  assert.equal(decide([f({ verdict: "block", critical: false })]).decision, "STOP");
});

test("unconfirmed critical block gives REVIEW, not STOP", () => {
  const r = decide([f({ verdict: "block", critical: true, corroboration: "single", summary: "x" })]);
  assert.equal(r.decision, "REVIEW");
  assert.equal(r.reasons[0], "Unconfirmed: x");
});

test("disputed critical block gives REVIEW", () => {
  const r = decide([f({ verdict: "block", critical: true, corroboration: "disputed", summary: "x" })]);
  assert.equal(r.decision, "REVIEW");
  assert.equal(r.reasons[0], "Miners disagree: x");
});

test("flag gives REVIEW", () => {
  assert.equal(decide([f({}), f({}), f({ verdict: "flag" })]).decision, "REVIEW");
});

test("critical unknown gives REVIEW, non-critical unknown alone does not", () => {
  assert.equal(decide([f({}), f({}), f({ verdict: "unknown", critical: true })]).decision, "REVIEW");
  const r = decide([f({}), f({}), f({ verdict: "unknown", critical: false })]);
  assert.equal(r.decision, "GO");
  assert.deepEqual(r.reasons, ["Every answered check came back clean; 1 non-critical check returned no usable answer."]);
});

test("disputed clear gives REVIEW", () => {
  assert.equal(decide([f({ corroboration: "disputed" })]).decision, "REVIEW");
});

test("less than two thirds answered gives REVIEW", () => {
  const r = decide([f({}), f({ verdict: "unknown" }), f({ verdict: "unknown", skipped: "budget" })]);
  assert.equal(r.decision, "REVIEW");
  assert.deepEqual(r.coverage, { total: 3, answered: 1, unknown: 2, skipped: 1 });
  assert.ok(r.reasons.some((x) => x.startsWith("Only 1 of 3")));
});

test("STOP reasons keep the review reasons after the blocking ones", () => {
  const r = decide([f({ verdict: "block", summary: "blocked" }), f({ verdict: "flag", summary: "flagged" })]);
  assert.equal(r.decision, "STOP");
  assert.deepEqual(r.reasons, ["blocked", "flagged"]);
});
