import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

const fail = (status: number, message: string, retryAfter?: number): never => {
  throw Object.assign(new Error(message), { status, retryAfter });
};

/** Trust forwarded client addresses only from an explicitly enabled loopback reverse proxy. */
export function clientAddress(req: IncomingMessage, trustLoopbackProxy: boolean): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  if (trustLoopbackProxy && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
    const forwarded = req.headers["x-forwarded-for"];
    const address = typeof forwarded === "string" ? forwarded.split(",").at(-1)!.trim() : "";
    if (isIP(address)) return address;
  }
  return remote;
}

export function createRequestGuard(options: {
  allowedHosts: Set<string>;
  publicOrigin?: string;
  trustLoopbackProxy?: boolean;
  now?: () => number;
}) {
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : undefined;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; until: number }>();
  let nextCleanup = 0;
  return (req: IncomingMessage): void => {
    let host: string;
    try { host = new URL(`http://${req.headers.host}`).hostname.toLowerCase(); }
    catch { return fail(403, "host not allowed"); }
    if (!req.headers.host || !options.allowedHosts.has(host)) fail(403, "host not allowed");
    if (req.method !== "GET" && req.method !== "HEAD") {
      const expectedOrigin = publicOrigin ?? `http://${req.headers.host}`;
      if (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin) fail(403, "cross-origin request refused");
      const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "application/json") fail(415, "content-type must be application/json");
    }
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/api/")) return;
    const timestamp = now();
    if (timestamp >= nextCleanup) {
      for (const [key, value] of buckets) if (value.until <= timestamp) buckets.delete(key);
      nextCleanup = timestamp + 60_000;
    }
    const paid = req.method === "POST" && pathname === "/api/runs";
    const category = paid ? "runs" : req.method === "POST" ? "quotes" : "reads";
    const limit = paid ? 3 : category === "quotes" ? 12 : 60;
    const window = paid ? 3_600_000 : 60_000;
    const key = `${clientAddress(req, options.trustLoopbackProxy ?? false)}:${category}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= timestamp) {
      if (!bucket && buckets.size >= 10_000) fail(429, "Demo busy. Please try again later.");
      bucket = { count: 0, until: timestamp + window };
      buckets.set(key, bucket);
    }
    if (++bucket.count > limit) fail(429, paid ? "Demo limit: three runs per hour per visitor. Please try again later." : "Too many requests. Please try again in a minute.", Math.ceil((bucket.until - timestamp) / 1000));
  };
}
