import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, Transaction, type Connection } from "@solana/web3.js";
import { loadMemo, memoDigest } from "../src/core/memo.ts";
import { decide } from "../src/core/policy.ts";
import type { Finding } from "../src/core/types.ts";
import { companiesHouseCheck, companiesHouseCheckId } from "../src/packs/companies-house.ts";
import { getPack, normaliseSubject } from "../src/packs/index.ts";
import { memoInstruction } from "../src/settlement/solana.ts";
import { matchesStartupAnchor } from "../src/settlement/startup-anchor.ts";

function registryResponse(number: string, name: string, status: string) {
  return Response.json({ primaryTopic: { CompanyNumber: number, CompanyName: name, CompanyStatus: status } });
}

test("Helio reference and ownership-conflict claims use the same filed evidence", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    assert.equal(url, "https://data.companieshouse.gov.uk/doc/company/13836904.json");
    return registryResponse("13836904", "HELIO FINTECH LTD", "Active");
  });
  const pack = getPack("startup");
  for (const [subject, verdict] of [[pack.example, "clear"], [pack.caseStudy!, "flag"]] as const) {
    const checks = await pack.plan(normaliseSubject(pack, subject), {});
    const records = checks.filter(check => "recordAssessment" in check);
    const control = records.find(check => check.id === "startup:controller");
    assert.equal(control?.recordAssessment.verdict, verdict);
    assert.match(control!.publicSource!, /company\/13836904\/filing-history\//);
    assert.equal(records.find(check => check.id === "startup:integration")?.recordAssessment.verdict, "clear");
    assert.equal(records.find(check => check.id === "startup:metric")?.recordAssessment.verdict, "unknown");
    assert.equal(records.find(check => check.id === companiesHouseCheckId)?.recordAssessment.verdict, "clear");
    assert.ok(checks.some(check => "intent" in check && check.intent === "CORPORATE_REGISTRY_LOOKUP_GENERAL"));
  }
});

test("A valid number belonging to another company triggers a Companies House mismatch", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    assert.equal(url, "https://data.companieshouse.gov.uk/doc/company/00000006.json");
    return registryResponse("00000006", "MARINE AND GENERAL MUTUAL LIFE ASSURANCE SOCIETY", "Dissolved");
  });
  const pack = getPack("startup");
  const checks = await pack.plan(normaliseSubject(pack, { ...pack.example, registration: "00000006" }), {});
  const records = checks.filter(check => "recordAssessment" in check);
  assert.equal(records.length, 4);
  const registry = records.find(check => check.id === companiesHouseCheckId);
  assert.equal(registry?.recordAssessment.verdict, "flag");
  assert.match(registry!.recordAssessment.summary, /00000006.*MARINE AND GENERAL/);
  assert.ok(records.filter(check => check !== registry).every(check => check.recordAssessment.verdict === "unknown" && !check.publicSource));
});

test("Companies House fails closed on HTTP errors and inconsistent numbers", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  assert.equal((await companiesHouseCheck("Helio Fintech Ltd", "13836904")).recordAssessment.verdict, "unknown");
  request.mock.mockImplementation(async () => registryResponse("13836905", "HELIO FINTECH LTD", "Active"));
  assert.equal((await companiesHouseCheck("Helio Fintech Ltd", "13836904")).recordAssessment.verdict, "unknown");
  assert.equal((await companiesHouseCheck("Helio Fintech Ltd", "../report")).publicSource, undefined);
  assert.equal(request.mock.callCount(), 2);
});

test("A confirmed official record resolves a missing miner answer and retains adverse findings", () => {
  const scope = getPack("startup").decisionFindings!;
  const check = (checkId: string, verdict: Finding["verdict"]): Finding => ({
    checkId, title: checkId, verdict, summary: checkId, why: "Test", critical: true, evidence: [], corroboration: "single",
  });
  const official = check(companiesHouseCheckId, "clear");
  const miner = check("registry:united-kingdom:helio", "unknown");
  const ownership = check("startup:controller", "clear");
  assert.equal(decide(scope([official, miner, ownership])).decision, "GO");
  assert.equal(decide(scope([official, { ...miner, verdict: "flag" }, ownership])).decision, "REVIEW");
  assert.equal(decide(scope([{ ...official, verdict: "unknown" }, miner, ownership])).decision, "REVIEW");
  assert.equal(decide(scope([official, miner, { ...ownership, verdict: "flag" }])).decision, "REVIEW");
});

test("the Devnet anchor binds the canonical memo digest and the expected signer", () => {
  const memo = loadMemo("commodities-2026-11-24-devnet-release")!;
  const { digest: _digest, signature, ...body } = memo;
  const startupBody = { ...body, pack: "startup" };
  const report = { ...startupBody, digest: memoDigest(startupBody), signature };
  const signer = Keypair.generate().publicKey;
  const other = Keypair.generate().publicKey;
  const instruction = memoInstruction("countersign:startup:v1:" + report.digest, [signer]);
  const message = new Transaction({ feePayer: signer, recentBlockhash: other.toBase58() }).add(instruction).compileMessage();
  const transaction = { meta: { err: null }, transaction: { message } } as NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>;
  assert.equal(matchesStartupAnchor(transaction, report, signer), true);
  assert.equal(matchesStartupAnchor(transaction, report, other), false);
  const edited = { ...startupBody, decision_label: "Edited report" };
  assert.equal(matchesStartupAnchor(transaction, { ...edited, digest: memoDigest(edited), signature }, signer), false);
});
