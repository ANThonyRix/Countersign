import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PackDefinition } from "../src/core/types.ts";

// Every external request is intercepted. The key and ledger exist only for this test process.
const dir = mkdtempSync(path.join(tmpdir(), "countersign-break-"));
process.env.COUNTERSIGN_DATA_DIR = dir;
process.env.TELEGRAPH_NODE = "https://telegraph.invalid";
process.env.SEPOLIA_RPC = "https://rpc.invalid";
const { config, ROOT } = await import("../src/config.ts");
const { Budget, daySpend } = await import("../src/core/budget.ts");
const { ask, computeSignalHash, quote } = await import("../src/telegraph/client.ts");
const { runPack } = await import("../src/core/agent.ts");
const { verifyMemoSignature, loadMemo } = await import("../src/core/memo.ts");
const { getPack, normaliseSubject } = await import("../src/packs/index.ts");
const { sanctionsCheck } = await import("../src/packs/checks.ts");
const account = privateKeyToAccount(generatePrivateKey());
const originalFetch = globalThis.fetch;
const originalTimeout = config.requestTimeoutMs;
let sequence = 0;

afterEach(() => { globalThis.fetch = originalFetch; config.requestTimeoutMs = originalTimeout; });
after(() => rmSync(dir, { recursive: true, force: true }));

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    // Keep the event loop alive and fail even if the production timeout is missing.
    const guard = setTimeout(() => reject(new Error("request did not time out")), 2000);
    const abort = () => { clearTimeout(guard); reject(signal.reason); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function localNode(options: { balance?: bigint; amount?: bigint; offline?: boolean; dispute?: boolean; noAlternative?: boolean; stall?: "before" | "after" | "body" } = {}) {
  const requests: { url: string; paid: boolean }[] = [];
  const signals = new Map<string, unknown>();
  const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...headers },
  });
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const paid = req.headers.has("payment-signature");
    requests.push({ url: req.url, paid });
    if (url.origin === "https://rpc.invalid") {
      const body = await req.json() as { id: number; method: string };
      assert.equal(body.method, "eth_call");
      return json({ jsonrpc: "2.0", id: body.id, result: `0x${(options.balance ?? 10_000_000n).toString(16).padStart(64, "0")}` });
    }
    assert.equal(url.origin, "https://telegraph.invalid", "unexpected external request");
    if (options.offline) throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    if (url.pathname.startsWith("/api/miners")) return json(options.noAlternative ? [] : [
      { id: "first", slug: "miner-first", name: "First", activation_status: "active" },
      { id: "second", slug: "miner-second", name: "Second", activation_status: "active" },
    ]);
    if (url.pathname === "/leaderboard/miners") return json({ intents: {} });
    if (url.pathname.startsWith("/engine/v1/signal/")) {
      const hash = url.pathname.split("/").pop()!;
      assert.ok(signals.has(hash), "agent asked for an unknown signal");
      return json(signals.get(hash));
    }
    assert.match(url.pathname, /^\/engine\/v1\/ask/);
    if (options.stall === "before" || (paid && options.stall === "after")) return waitForAbort(req.signal);
    if (!paid) {
      const challenge = { x402Version: 2, resource: { url: req.url, description: "Test check", mimeType: "application/json" }, accepts: [{
        scheme: "exact", network: config.network, asset: config.usdc, payTo: config.diamond,
        amount: String(options.amount ?? 10_000n), maxTimeoutSeconds: 300,
        extra: { name: "USDC", version: "2" },
      }] };
      return json({ error: "payment required" }, 402, { "payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") });
    }
    const authorization = JSON.parse(Buffer.from(req.headers.get("payment-signature")!, "base64").toString("utf8"));
    assert.match(authorization.payload.signature, /^0x[0-9a-f]{130}$/i);
    assert.equal(authorization.payload.authorization.from.toLowerCase(), account.address.toLowerCase());
    if (options.stall === "body") {
      return new Response(new ReadableStream({
        start(controller) { void waitForAbort(req.signal).catch((err) => controller.error(err)); },
      }));
    }
    const second = url.pathname.endsWith("/second");
    const miner = second ? "second" : "first";
    const result = { matched: !second, match_score: 0.99, lists: ["TEST LIST"] };
    const answer = options.dispute ? result : { ...result, matched: true };
    const payload = { wallet_address: account.address, miner_slug: `miner-${miner}`, response: answer, sequence: sequence++ };
    const hash = computeSignalHash(payload);
    signals.set(hash, { payload, signal: { wallet_address: account.address }, verification: { verified: true } });
    return json({ miner_id: miner, miner_name: `Miner ${miner}`, intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
      result: answer, result_shape: "intent", field_status: { matched: "ok", match_score: "ok", lists: "ok" }, signal_hash: hash });
  };
  return requests;
}

const input = { intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: "Test Entity" } };
const pack: PackDefinition = {
  ...getPack("legal"),
  plan: () => [sanctionsCheck("Test Entity", "entity", false)],
};

test("break: malformed token is refused by the CLI before network access", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "run", "exchange", "--project", "Test", "--token", "0xBAD"], {
    cwd: ROOT, encoding: "utf8", timeout: 15_000, env: { ...process.env, AGENT_PRIVATE_KEY: generatePrivateKey() },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Token contract must be a 0x address/);
  assert.throws(() => normaliseSubject(getPack("exchange"), { project: "Test", token: "0xBAD" }), { status: 400 });
});

test("break: an empty wallet explains how to fund it before buying checks", async () => {
  const requests = localNode({ balance: 0n });
  await assert.rejects(runPack(pack, { entity: "Test Entity" }, { account, budget: new Budget(1, 100) }), /no test USDC.*mint/i);
  assert.equal(requests.filter((r) => r.paid).length, 0);
});

test("break: run cap refuses an x402 challenge before signing", async () => {
  const requests = localNode();
  const budget = new Budget(0.005, 100);
  await assert.rejects(ask(input, { account, budget }), /run budget exhausted/);
  assert.equal(requests.filter((r) => r.paid).length, 0);
  assert.equal(budget.spentUsd, 0);
  assert.equal(budget.remainingUsd, 0.005);
});

test("break: daily cap refuses an x402 challenge before signing", async () => {
  const requests = localNode();
  const budget = new Budget(1, 0);
  await assert.rejects(ask(input, { account, budget }), /daily budget exhausted/);
  assert.equal(requests.filter((r) => r.paid).length, 0);
  assert.equal(budget.spentUsd, 0);
});

test("break: per-payment ceiling refuses an expensive x402 challenge", async () => {
  const requests = localNode({ amount: 200_000n });
  const budget = new Budget(1, 100);
  await assert.rejects(ask(input, { account, budget }), /spendControls|refus|exceed/i);
  assert.equal(requests.filter((r) => r.paid).length, 0);
  assert.equal(budget.spentUsd, 0);
});

test("break: an exhausted run produces a signed REVIEW memo with skipped checks", async () => {
  const requests = localNode();
  const memo = await runPack(pack, { entity: "Test Entity" }, { account, budget: new Budget(0, 100) });
  assert.equal(memo.decision, "REVIEW");
  assert.equal(memo.findings[0].skipped, "budget");
  assert.match(memo.findings[0].summary, /\$0\.00/);
  assert.equal(memo.cost.total_usd, 0);
  assert.equal(requests.filter((r) => r.paid).length, 0);
  assert.equal((await verifyMemoSignature(memo)).digestMatches, true);
});

test("break: disagreeing miners produce REVIEW and retain both verified answers", async () => {
  const requests = localNode({ dispute: true });
  const memo = await runPack(pack, { entity: "Test Entity" }, { account, budget: new Budget(1, 100) });
  assert.equal(memo.decision, "REVIEW");
  assert.equal(memo.findings[0].corroboration, "disputed");
  assert.match(memo.reasons.join(" "), /Miners disagree/);
  assert.deepEqual(memo.evidence.map((e) => e.minerId), ["first", "second"]);
  assert.deepEqual(memo.evidence.map((e) => e.verdict), ["block", "clear"]);
  assert.ok(memo.evidence.every((e) => e.verification?.localHashMatch && e.verification.payerMatches));
  assert.equal(requests.filter((r) => r.paid).length, 2);
  assert.equal(memo.cost.total_usd, 0.02);
  assert.equal(loadMemo(memo.id)?.digest, memo.digest);
  assert.equal((await verifyMemoSignature(memo)).signerMatches, true);
});

test("break: two agreeing miners produce STOP for a confirmed block", async () => {
  localNode();
  const memo = await runPack(pack, { entity: "Test Entity" }, { account, budget: new Budget(1, 100) });
  assert.equal(memo.decision, "STOP");
  assert.equal(memo.findings[0].corroboration, "confirmed");
});

test("break: missing alternative miner leaves an unconfirmed block at REVIEW", async () => {
  localNode({ noAlternative: true });
  const noAlternativePack: PackDefinition = { ...pack, plan: () => [{ ...sanctionsCheck("Test Entity", "entity", false), intent: "TEST_NO_ALTERNATIVE" }] };
  const memo = await runPack(noAlternativePack, { entity: "Test Entity" }, { account, budget: new Budget(1, 100) });
  assert.equal(memo.decision, "REVIEW");
  assert.equal(memo.findings[0].corroboration, "single");
  assert.match(memo.evidence[1].error ?? "", /no alternative miner/);
  assert.equal(memo.cost.total_usd, 0.01);
});

test("break: offline node gives an actionable quote error without payment", async () => {
  const requests = localNode({ offline: true });
  await assert.rejects(quote(input), /Cannot reach Telegraph node.*TELEGRAPH_NODE/);
  assert.equal(requests.filter((r) => r.paid).length, 0);
});

test("break: offline node produces REVIEW with all critical checks unknown", async () => {
  const requests = localNode({ offline: true });
  const before = daySpend().spentUsd;
  const memo = await runPack(pack, { entity: "Test Entity" }, { account, budget: new Budget(1, 100) });
  assert.equal(memo.decision, "REVIEW");
  assert.equal(memo.coverage.answered, 0);
  assert.match(memo.evidence[0].error ?? "", /Cannot reach Telegraph node/);
  assert.equal(memo.cost.total_usd, 0);
  assert.equal(daySpend().spentUsd, before);
  assert.equal(requests.filter((r) => r.paid).length, 0);
});

for (const id of ["exchange", "commodities", "legal"]) {
  test(`break: the complete ${id} pack fails closed when the node is offline`, async () => {
    const requests = localNode({ offline: true });
    const selected = getPack(id);
    // Keep the optional mainnet treasury lookup out of this Telegraph outage scenario.
    const subject = normaliseSubject(selected, { ...selected.example, treasury: "" });
    const memo = await runPack(selected, subject, { account, budget: new Budget(1, 100) });
    assert.equal(memo.decision, "REVIEW");
    assert.equal(memo.coverage.total, (await selected.plan(subject, {})).length);
    assert.equal(memo.coverage.answered, 0);
    assert.ok(memo.findings.every((f) => f.verdict === "unknown"));
    assert.equal(memo.cost.total_usd, 0);
    assert.equal(requests.filter((r) => r.paid).length, 0);
    assert.equal((await verifyMemoSignature(memo)).digestMatches, true);
  });
}

test("break: a stalled quote times out with a useful message", async () => {
  config.requestTimeoutMs = 200;
  const requests = localNode({ stall: "before" });
  await assert.rejects(quote(input), /timed out after 200 ms.*TELEGRAPH_NODE/);
  assert.equal(requests.filter((r) => r.paid).length, 0);
});

for (const stall of ["after", "body"] as const) {
  test(`break: timeout ${stall === "after" ? "after signing" : "reading the paid body"} retains the budget charge and REVIEW evidence`, async () => {
    config.requestTimeoutMs = 200;
    const requests = localNode({ stall });
    const budget = new Budget(0.01, 100);
    const before = daySpend().spentUsd;
    const memo = await runPack(pack, { entity: "Test Entity" }, { account, budget });
    assert.equal(memo.decision, "REVIEW");
    assert.equal(memo.findings[0].verdict, "unknown");
    assert.match(memo.evidence[0].error ?? "", /timed out.*settlement is unknown/);
    assert.equal(requests.filter((r) => r.paid).length, 1, "never retry a signed ambiguous payment");
    assert.equal(budget.spentUsd, 0.01);
    assert.equal(budget.remainingUsd, 0);
    assert.equal(Math.round((daySpend().spentUsd - before) * 1_000_000), 10_000);
    assert.equal(memo.cost.total_usd, 0.01);
    assert.equal(memo.cost.paid_calls, 1);
  });
}

test("break: a signed timeout on a pinned miner never falls back to another miner", async () => {
  config.requestTimeoutMs = 200;
  const requests = localNode({ stall: "after" });
  const pinned: PackDefinition = { ...pack, plan: () => [{ ...sanctionsCheck("Test Entity", "entity", false), pinIntent: true }] };
  const memo = await runPack(pinned, { entity: "Test Entity" }, { account, budget: new Budget(0.03, 100) });
  assert.equal(memo.decision, "REVIEW");
  assert.equal(requests.filter((r) => r.paid).length, 1);
  assert.equal(memo.cost.total_usd, 0.01);
});
