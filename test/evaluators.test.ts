import { test } from "node:test";
import assert from "node:assert/strict";
import { adverseMedia, agrees, documentAuthenticity, onchainBalance, portCongestion, registry, sanctions } from "../src/core/evaluators.ts";
import type { AskResponse } from "../src/telegraph/types.ts";

const shaped = (result: Record<string, unknown>, okFields = Object.keys(result)): AskResponse => ({
  result,
  result_shape: "intent",
  field_status: Object.fromEntries(okFields.map((k) => [k, "ok"])),
});

test("sanctions: no match is clear", () => {
  assert.equal(sanctions("Acme")(shaped({ matched: false })).verdict, "clear");
});

test("sanctions: strong match blocks, weak match flags", () => {
  assert.equal(sanctions("Acme")(shaped({ matched: true, match_score: 0.97, lists: ["OFAC SDN"] })).verdict, "block");
  assert.equal(sanctions("Acme")(shaped({ matched: true, match_score: 0.6 })).verdict, "flag");
  assert.equal(sanctions("Acme")(shaped({ matched: true })).verdict, "block");
});

test("sanctions: unreadable field is unknown, never clear", () => {
  const r: AskResponse = { result: { matched: false }, result_shape: "intent", field_status: { matched: "missing" } as AskResponse["field_status"] };
  assert.equal(sanctions("Acme")(r).verdict, "unknown");
  assert.equal(sanctions("Acme")({ result: "free text", result_shape: "raw" }).verdict, "unknown");
});

test("registry: inactive company blocks, active is clear", () => {
  assert.equal(registry("Acme", "GB")(shaped({ legal_name: "ACME LTD", active: false })).verdict, "block");
  const clear = registry("Acme", "GB")(shaped({ legal_name: "ACME LTD", registration_id: "123", active: true }));
  assert.equal(clear.verdict, "clear");
  assert.match(clear.summary, /reg\. 123/);
});

test("registry: record without status is unknown", () => {
  assert.equal(registry("Acme", "GB")(shaped({ legal_name: "ACME LTD", active: null }, ["legal_name"])).verdict, "unknown");
});

test("adverseMedia: negated terms do not flag", () => {
  const clean = adverseMedia("Acme")(shaped({ answer: "There is no record of fraud or lawsuits involving Acme in public sources." }));
  assert.equal(clean.verdict, "clear");
});

test("adverseMedia: plain adverse terms flag", () => {
  const hit = adverseMedia("Acme")(shaped({ answer: "Acme was charged with fraud by regulators in 2024 and later fined." }));
  assert.equal(hit.verdict, "flag");
  assert.match(hit.summary, /fraud/);
});

test("adverseMedia: empty answer is unknown", () => {
  assert.equal(adverseMedia("Acme")(shaped({ answer: "" }, [])).verdict, "unknown");
});

test("portCongestion: high level or long wait flags", () => {
  assert.equal(portCongestion("Rotterdam")(shaped({ congestion_level: "high" })).verdict, "flag");
  assert.equal(portCongestion("Rotterdam")(shaped({ congestion_level: "low", wait_hours: 96 })).verdict, "flag");
  assert.equal(portCongestion("Rotterdam")(shaped({ congestion_level: "low", wait_hours: 6 })).verdict, "clear");
});

test("documentAuthenticity maps verdict labels", () => {
  assert.equal(documentAuthenticity()(shaped({ verdict: "Forged" })).verdict, "block");
  assert.equal(documentAuthenticity()(shaped({ verdict: "Likely forged" })).verdict, "flag");
  assert.equal(documentAuthenticity()(shaped({ verdict: "Inconclusive" })).verdict, "unknown");
  assert.equal(documentAuthenticity()(shaped({ verdict: "Authentic" })).verdict, "clear");
});

test("onchainBalance: empty treasury flags", () => {
  assert.equal(onchainBalance("0xabc")(shaped({ balance_gwei: 0, block: 1 })).verdict, "flag");
  assert.equal(onchainBalance("0xabc")(shaped({ balance_gwei: 2e9, block: 1 })).verdict, "clear");
});

test("agrees: same direction agrees, unknown never counts", () => {
  assert.equal(agrees({ verdict: "block", summary: "" }, { verdict: "flag", summary: "" }), true);
  assert.equal(agrees({ verdict: "block", summary: "" }, { verdict: "clear", summary: "" }), false);
  assert.equal(agrees({ verdict: "clear", summary: "" }, { verdict: "unknown", summary: "" }), undefined);
});

test("identity headquarters: a city inside a reviewed country is in scope, another country is not", async () => {
  const { hqInScope } = await import("../src/packs/checks.ts");
  assert.equal(hqInScope("London", ["United Kingdom", "Lithuania"]), true);
  assert.equal(hqInScope("Vilnius, Lithuania", ["United Kingdom", "Lithuania"]), true);
  assert.equal(hqInScope("Dubai, UAE", ["United Kingdom"]), false);
  assert.equal(hqInScope("Springfield", ["Singapore"]), true);
  assert.equal(hqInScope("", ["Singapore"]), true);
});
