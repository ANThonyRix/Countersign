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

const WEB = path.join(ROOT, "web");
// The run endpoint spends from the agent wallet, so listen on loopback unless told otherwise.
const HOST = process.env.HOST ?? "127.0.0.1";

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
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { status: 400 });
  }
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
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
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

function serveStatic(res: ServerResponse, urlPath: string) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  try {
    if (req.method === "GET" && p === "/api/status") {
      const wallet = hasAgentKey() ? await walletStatus().catch((e: Error) => ({ error: e.message })) : null;
      return send(res, 200, {
        node: config.node,
        network: config.network,
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
    const memoMatch = p.match(/^\/api\/memos\/([A-Za-z0-9-]+)(\/verify)?$/);
    if (req.method === "GET" && memoMatch) {
      if (memoMatch[2]) return send(res, 200, await verifyMemo(memoMatch[1]));
      const memo = loadMemo(memoMatch[1]);
      return memo ? send(res, 200, memo) : send(res, 404, { error: "memo not found" });
    }
    if (p.startsWith("/api/")) return send(res, 404, { error: "not found" });
    if (req.method === "GET") return serveStatic(res, p);
    send(res, 405, { error: "method not allowed" });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    send(res, status, { error: (err as Error).message });
  }
});

server.listen(config.port, HOST, () => {
  console.log(`Countersign running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${config.port}`);
  if (!hasAgentKey()) console.log("No agent wallet yet: run `npm run wallet:new`. Example memos are still viewable.");
});
