import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config, hasAgentKey, ROOT } from "./config.ts";
import { dryRun, runPack } from "./core/agent.ts";
import { daySpend } from "./core/budget.ts";
import { listMemos, loadMemo, verifyMemoSignature } from "./core/memo.ts";
import type { AgentEvent } from "./core/types.ts";
import { walletStatus } from "./core/wallet.ts";
import { getPack, normaliseSubject, packs } from "./packs/index.ts";
import { verifySignal } from "./telegraph/client.ts";
import { createRequestGuard } from "./http/guard.ts";
import { settlementStatus } from "./settlement/status.ts";

const WEB = path.join(ROOT, "web");
// The run endpoint spends from the agent wallet, so listen on loopback unless told otherwise.
const HOST = process.env.HOST ?? "127.0.0.1";
// Host names the server answers to. Blocks DNS rebinding: a hostile page that points its own
// domain at 127.0.0.1 still sends its own Host header. Extra names come from ALLOWED_HOSTS.
const ALLOWED_HOSTS = new Set(
  ["localhost", "127.0.0.1", "[::1]", HOST, ...(process.env.ALLOWED_HOSTS ?? "").split(",")]
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h && h !== "0.0.0.0" && h !== "::"),
);
const MAX_FINISHED_RUNS = 20;
const SECURITY_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" };
const guardRequest = createRequestGuard({
  allowedHosts: ALLOWED_HOSTS,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  trustLoopbackProxy: process.env.TRUST_LOOPBACK_PROXY === "true",
});

interface Run {
  id: string;
  pack: string;
  subject: string;
  events: AgentEvent[];
  listeners: Set<ServerResponse>;
  done: boolean;
  memoId?: string;
  error?: string;
}
const runs = new Map<string, Run>();
let activeRun: Run | undefined;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw httpError(400, "JSON body must be an object");
  const body = parsed as Record<string, unknown>;
  if (body.subject !== undefined && (!body.subject || typeof body.subject !== "object" || Array.isArray(body.subject))) {
    throw httpError(400, "subject must be an object");
  }
  return body;
}

function packView() {
  return Object.values(packs).map((p) => ({
    id: p.id,
    mission: p.mission,
    title: p.title,
    tagline: p.tagline,
    labels: p.labels,
    fields: p.fields,
    example: p.example,
    caseStudy: p.caseStudy,
    paymentCases: p.paymentCases,
  }));
}

function broadcast(run: Run, event: AgentEvent) {
  run.events.push(event);
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const l of run.listeners) l.write(line);
}

function finish(run: Run) {
  run.done = true;
  for (const l of run.listeners) {
    l.write(`event: end\ndata: ${JSON.stringify({ memoId: run.memoId, error: run.error })}\n\n`);
    l.end();
  }
  run.listeners.clear();
  if (activeRun === run) activeRun = undefined;
  // Keep only the most recent finished runs in memory; memos themselves are on disk.
  const finished = [...runs.values()].filter((r) => r.done);
  for (const old of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_RUNS))) runs.delete(old.id);
}

async function startRun(body: Record<string, unknown>) {
  if (!hasAgentKey()) throw Object.assign(new Error("No agent wallet configured. Run `npm run wallet:new`."), { status: 412 });
  if (activeRun) throw Object.assign(new Error("A run is already in progress. Wait for it to finish."), { status: 409 });
  const pack = getPack(String(body.pack));
  const subject = normaliseSubject(pack, (body.subject ?? {}) as Record<string, unknown>);
  const run: Run = { id: randomUUID(), pack: pack.id, subject: pack.subjectName(subject), events: [], listeners: new Set(), done: false };
  runs.set(run.id, run);
  activeRun = run;
  runPack(pack, subject, { onEvent: (e) => broadcast(run, e) })
    .then((memo) => {
      run.memoId = memo.id;
    })
    .catch((err: Error) => {
      run.error = err.message;
      broadcast(run, { type: "error", message: err.message });
    })
    .finally(() => finish(run));
  return { runId: run.id };
}

function streamRun(req: IncomingMessage, res: ServerResponse, id: string) {
  const run = runs.get(id);
  if (!run) return send(res, 404, { error: "run not found" });
  res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  for (const e of run.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (run.done) {
    res.write(`event: end\ndata: ${JSON.stringify({ memoId: run.memoId, error: run.error })}\n\n`);
    return res.end();
  }
  run.listeners.add(res);
  req.on("close", () => run.listeners.delete(res));
}

async function verifyMemo(id: string) {
  const memo = loadMemo(id);
  if (!memo) throw Object.assign(new Error("memo not found"), { status: 404 });
  const signature = await verifyMemoSignature(memo);
  const signals = await Promise.all(
    memo.evidence.filter((e) => e.signalHash).map(async (e) => ({ evidenceId: e.id, ...(await verifySignal(e.signalHash!, memo.agent)) })),
  );
  const ok = signature.digestMatches && signature.signerMatches && signals.every((s) => s.found && s.nodeVerified && s.localHashMatch && !s.error);
  return { ok, signature, signals, checkedAt: new Date().toISOString() };
}

function videoRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end ? { start, end } : null;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string) {
  let rel: string;
  try {
    rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, "content-type": "text/plain" });
    return res.end("bad request");
  }
  const file = path.resolve(WEB, rel);
  // Dot segments (.taste-skill, .git, .env and the like) are tooling, never site content.
  const hidden = path.relative(WEB, file).split(path.sep).some((s) => s.startsWith("."));
  const stats = !hidden && file.startsWith(WEB + path.sep) && existsSync(file)
    ? statSync(file, { throwIfNoEntry: false }) : undefined;
  if (!stats?.isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain" });
    return res.end("not found");
  }
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  const headers = {
    ...SECURITY_HEADERS, "content-type": type, "cache-control": "no-cache",
    ...(type === "video/mp4" ? { "accept-ranges": "bytes" } : {}),
  };
  const requestedRange = type === "video/mp4" && req.method === "GET" && !req.headers["if-range"] ? req.headers.range : undefined;
  const range = requestedRange ? videoRange(requestedRange, stats.size) : undefined;
  if (range === null) {
    res.writeHead(416, { ...headers, "content-range": `bytes */${stats.size}`, "content-length": 0 });
    return res.end();
  }
  res.writeHead(range ? 206 : 200, {
    ...headers,
    "content-length": range ? range.end - range.start + 1 : stats.size,
    ...(range ? { "content-range": `bytes ${range.start}-${range.end}/${stats.size}` } : {}),
  });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(file, range);
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  try {
    guardRequest(req);
    if (req.method === "GET" && p === "/healthz") return send(res, 200, { ok: true });
    if (req.method === "GET" && p === "/api/status") {
      const wallet = hasAgentKey() ? await walletStatus().catch((e: Error) => ({ error: e.message })) : null;
      return send(res, 200, {
        node: config.node,
        network: config.network,
        paymentRail: config.paymentRail,
        wallet,
        budget: { perRunUsd: config.maxUsdPerRun, ...daySpend() },
        running: activeRun ? { id: activeRun.id, pack: activeRun.pack, subject: activeRun.subject } : null,
      });
    }
    if (req.method === "GET" && p === "/api/packs") return send(res, 200, packView());
    if (req.method === "POST" && p === "/api/plan") {
      const body = await readJson(req);
      const pack = getPack(String(body.pack));
      const subject = normaliseSubject(pack, (body.subject ?? {}) as Record<string, unknown>);
      return send(res, 200, await dryRun(pack, subject));
    }
    if (req.method === "POST" && p === "/api/runs") return send(res, 202, await startRun(await readJson(req)));
    const runMatch = p.match(/^\/api\/runs\/([0-9a-f-]{36})\/events$/);
    if (req.method === "GET" && runMatch) return streamRun(req, res, runMatch[1]);
    if (req.method === "GET" && p === "/api/memos") return send(res, 200, listMemos());
    const memoMatch = p.match(/^\/api\/memos\/([A-Za-z0-9-]+)(\/(verify|settlement))?$/);
    if (req.method === "GET" && memoMatch) {
      if (memoMatch[3] === "verify") return send(res, 200, await verifyMemo(memoMatch[1]));
      const memo = loadMemo(memoMatch[1]);
      if (memo && memoMatch[3] === "settlement") return send(res, 200, await settlementStatus(memo));
      return memo ? send(res, 200, memo) : send(res, 404, { error: "memo not found" });
    }
    if (p.startsWith("/api/")) return send(res, 404, { error: "not found" });
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, p);
    send(res, 405, { error: "method not allowed" });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status === 429) res.setHeader("retry-after", String((err as { retryAfter?: number }).retryAfter ?? 60));
    send(res, status, { error: (err as Error).message });
  }
});

server.listen(config.port, HOST, () => {
  console.log(`Countersign running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${config.port}`);
  if (!hasAgentKey()) console.log("No agent wallet yet: run `npm run wallet:new`. Example memos are still viewable.");
});
