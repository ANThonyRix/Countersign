import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { clientAddress, createRequestGuard } from "../src/http/guard.ts";

function request(overrides: Record<string, unknown> = {}): IncomingMessage {
  return { method: "POST", url: "/api/runs", headers: { host: "countersign.ink", origin: "https://countersign.ink", "content-type": "application/json" }, socket: { remoteAddress: "127.0.0.1" }, ...overrides } as IncomingMessage;
}
const options = { allowedHosts: new Set(["countersign.ink"]), publicOrigin: "https://countersign.ink" };

test("public HTTPS origin works while foreign origins and hosts are refused", () => {
  const guard = createRequestGuard(options);
  assert.doesNotThrow(() => guard(request()));
  for (const headers of [
    { host: "evil.example", "content-type": "application/json" },
    { host: "countersign.ink", origin: "https://evil.example", "content-type": "application/json" },
    { host: "countersign.ink", origin: "http://countersign.ink", "content-type": "application/json" },
  ]) assert.throws(() => guard(request({ headers })), { status: 403 });
  assert.throws(() => guard(request({ headers: { host: "countersign.ink", "content-type": "text/plain" } })), { status: 415 });
});

test("paid run quota is per visitor, distinct from free quotes, and expires", () => {
  let time = 0;
  const guard = createRequestGuard({ ...options, now: () => time });
  for (let i = 0; i < 3; i++) guard(request());
  assert.throws(() => guard(request()), { status: 429 });
  assert.doesNotThrow(() => guard(request({ url: "/api/plan" })));
  assert.doesNotThrow(() => guard(request({ socket: { remoteAddress: "192.0.2.1" } })));
  time = 3_600_001;
  assert.doesNotThrow(() => guard(request()));
});

test("forwarded IP is trusted only from an explicitly trusted loopback proxy", () => {
  const proxied = request({ headers: { "x-forwarded-for": "192.0.2.1, 192.0.2.2" } });
  assert.equal(clientAddress(proxied, true), "192.0.2.2");
  assert.equal(clientAddress(proxied, false), "127.0.0.1");
  assert.equal(clientAddress(request({ headers: { "x-forwarded-for": "192.0.2.1" }, socket: { remoteAddress: "198.51.100.1" } }), true), "198.51.100.1");
});
