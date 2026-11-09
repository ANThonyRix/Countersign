import type { AskResponse } from "../telegraph/types.ts";
import type { Assessment } from "./types.ts";

type Result = Record<string, unknown>;

function shaped(r: AskResponse): Result | undefined {
  if (r.result_shape !== "intent" || !r.result || typeof r.result !== "object") return undefined;
  return r.result as Result;
}

/** True when the field was read from the miner's answer (not missing, rejected or unavailable). */
function ok(r: AskResponse, field: string): boolean {
  return r.field_status?.[field] === "ok";
}

function unknown(r: AskResponse, field: string, what: string): Assessment {
  const status = r.field_status?.[field] ?? (r.result_shape === "raw" ? `raw (${r.shape_error ?? "unshaped"})` : "absent");
  return { verdict: "unknown", summary: `${what}: the miner's answer did not contain a usable \`${field}\` (status: ${status}).` };
}

const list = (v: unknown): string =>
  Array.isArray(v) ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).slice(0, 5).join("; ") : v == null ? "" : String(v);

export function sanctions(subject: string) {
  return (r: AskResponse): Assessment => {
    const res = shaped(r);
    if (!res || !ok(r, "matched")) return unknown(r, "matched", `Sanctions screen for "${subject}"`);
    const score = typeof res.match_score === "number" ? res.match_score : undefined;
    const facts = { matched: res.matched, lists: res.lists, matches: res.matches, match_score: score };
    if (res.matched !== true) {
      return { verdict: "clear", summary: `No sanctions match for "${subject}".`, facts };
    }
    const where = list(res.lists) || list(res.matches) || "an unnamed list";
    if (score !== undefined && score < 0.85) {
      return { verdict: "flag", summary: `Possible sanctions match for "${subject}" (score ${score}) on ${where}. Needs analyst review.`, facts };
    }
    return { verdict: "block", summary: `Sanctions match for "${subject}" on ${where}${score !== undefined ? ` (score ${score})` : ""}.`, facts };
  };
}

export function registry(company: string, jurisdiction: string) {
  return (r: AskResponse): Assessment => {
    const res = shaped(r);
    if (!res) return unknown(r, "active", `Registry lookup for "${company}" in ${jurisdiction}`);
    const facts = {
      legal_name: res.legal_name,
      registration_id: res.registration_id,
      jurisdiction: res.jurisdiction,
      registered_address: res.registered_address,
      incorporated: res.incorporated,
      active: res.active,
    };
    if (!ok(r, "active")) {
      if (!ok(r, "legal_name") && !ok(r, "registration_id")) {
        return { verdict: "unknown", summary: `No registry record found for "${company}" in ${jurisdiction}.`, facts };
      }
      return { verdict: "unknown", summary: `Registry record for "${company}" in ${jurisdiction} found but its status could not be read.`, facts };
    }
    if (res.active === false) {
      return { verdict: "block", summary: `Registry shows "${res.legal_name ?? company}" in ${jurisdiction} is not active (dissolved, struck off or similar).`, facts };
    }
    const id = res.registration_id ? `, reg. ${res.registration_id}` : "";
    return { verdict: "clear", summary: `"${res.legal_name ?? company}" is registered and active in ${jurisdiction}${id}.`, facts };
  };
}

const ADVERSE = /\b(fraud\w*|scam\w*|lawsuit\w*|sued|indict\w*|charged|convict\w*|sanction\w*|money[- ]launder\w*|bankrupt\w*|insolven\w*|liquidat\w*|hack(ed|s)?|exploit\w*|rug[- ]?pull\w*|ponzi|investigat\w*|seiz\w*|penalt\w*|fine[ds]?)\b/gi;
const NEGATED = /\b(no|not|none|without|nothing|zero)\b[^.]{0,60}$/i;

/** Heuristic adverse-media screen over the search answer. It reports the terms it saw. */
export function adverseMedia(subject: string) {
  return (r: AskResponse): Assessment => {
    const res = shaped(r);
    const text = res ? [res.answer, res.brief].filter(Boolean).join(" ") : typeof r.result === "string" ? r.result : JSON.stringify(r.result ?? "");
    if (!text || text.length < 20) return unknown(r, "answer", `Adverse-media search for "${subject}"`);
    const hits = new Set<string>();
    for (const m of text.matchAll(ADVERSE)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 80), m.index);
      const sentenceStart = before.lastIndexOf(".");
      if (!NEGATED.test(before.slice(sentenceStart + 1))) hits.add(m[0].toLowerCase());
    }
    const facts = { result_count: res?.result_count, sources: res?.sources, excerpt: text.slice(0, 400) };
    if (hits.size === 0) return { verdict: "clear", summary: `No adverse-media terms found for "${subject}" (heuristic screen).`, facts };
    return { verdict: "flag", summary: `Adverse-media terms for "${subject}": ${[...hits].slice(0, 6).join(", ")}. Read the sources.`, facts };
  };
}

export function botDetection(account: string) {
  return (r: AskResponse): Assessment => {
    const res = shaped(r);
    if (!res || !ok(r, "verdict")) return unknown(r, "verdict", `Bot check for ${account}`);
    const facts = { verdict: res.verdict, bot_score: res.bot_score, signals: res.signals };
    const v = String(res.verdict).toLowerCase();
    if (v === "bot" || v === "likely_bot") return { verdict: "flag", summary: `${account} looks automated (${v}${res.bot_score != null ? `, score ${res.bot_score}` : ""}).`, facts };
    if (v === "inconclusive") return { verdict: "unknown", summary: `Bot check for ${account} was inconclusive.`, facts };
    return { verdict: "clear", summary: `${account} looks human-run (${v}).`, facts };
  };
}

export function documentAuthenticity() {
  return (r: AskResponse): Assessment => {
    const res = shaped(r);
    if (!res || !ok(r, "verdict")) return unknown(r, "verdict", "Document authenticity");
    const facts = { verdict: res.verdict, authentic: res.authentic, evidence: res.evidence };
    switch (String(res.verdict)) {
      case "Forged":
        return { verdict: "block", summary: "Document judged forged.", facts };
      case "Likely forged":
        return { verdict: "flag", summary: "Document judged likely forged.", facts };
      case "Inconclusive":
        return { verdict: "unknown", summary: "Document authenticity inconclusive.", facts };
      default:
        return { verdict: "clear", summary: `Document judged ${String(res.verdict).toLowerCase()}.`, facts };
    }
  };
}

export function portCongestion(port: string) {
  return (r: AskResponse): Assessment => {
    const res = shaped(r);
    if (!res || (!ok(r, "congestion_level") && !ok(r, "wait_hours"))) return unknown(r, "congestion_level", `Congestion at ${port}`);
    const facts = { congestion_level: res.congestion_level, wait_hours: res.wait_hours, vessels_waiting: res.vessels_waiting, as_of: res.as_of };
    const level = String(res.congestion_level ?? "").toLowerCase();
    const wait = typeof res.wait_hours === "number" ? res.wait_hours : undefined;
    const detail = [level && `${level} congestion`, wait !== undefined && `~${wait} h wait`, res.vessels_waiting != null && `${res.vessels_waiting} vessels waiting`]
      .filter(Boolean)
      .join(", ");
    if (level === "severe" || level === "high" || (wait !== undefined && wait > 72)) {
      return { verdict: "flag", summary: `${port}: ${detail}. Delivery window and demurrage at risk.`, facts };
    }
    return { verdict: "clear", summary: `${port}: ${detail || "no material congestion"}.`, facts };
  };
}

export function codeReview() {
  return (r: AskResponse): Assessment => {
    const res = shaped(r);
    if (!res || !ok(r, "verdict")) return unknown(r, "verdict", "Code review");
    const facts = { verdict: res.verdict, findings: res.findings, summary: res.summary };
    if (String(res.verdict) === "Request changes") return { verdict: "flag", summary: `Code review requests changes: ${list(res.findings) || res.summary}`.slice(0, 400), facts };
    return { verdict: "clear", summary: `Code review: ${res.verdict}. ${res.summary ?? ""}`.trim().slice(0, 400), facts };
  };
}

export function onchainBalance(address: string) {
  return (r: AskResponse): Assessment => {
    const res = shaped(r);
    if (!res || !ok(r, "balance_gwei")) return unknown(r, "balance_gwei", `Balance of ${address}`);
    const gwei = Number(res.balance_gwei);
    const eth = gwei / 1e9;
    const facts = { balance_gwei: res.balance_gwei, balance_eth: eth, block: res.block, chain: res.chain };
    if (!Number.isFinite(gwei)) return unknown(r, "balance_gwei", `Balance of ${address}`);
    if (gwei === 0) return { verdict: "flag", summary: `Treasury ${address} holds 0 ETH at block ${res.block}.`, facts };
    return { verdict: "clear", summary: `Treasury ${address} holds ${eth.toFixed(4)} ETH at block ${res.block}.`, facts };
  };
}

/**
 * For intents with no response schema the answer is the miner's raw output.
 * The agent scans it for risk terms and says so; it never claims more than that.
 */
export function rawRiskScan(what: string, riskTerms: RegExp, cleanTerms?: RegExp) {
  return (r: AskResponse): Assessment => {
    const text = typeof r.result === "string" ? r.result : JSON.stringify(r.result ?? "");
    if (!text || text.length < 30 || /^\s*\{?\s*"?(error|detail)"?\s*:/i.test(text)) {
      return { verdict: "unknown", summary: `${what}: the miner returned no usable answer.`, facts: { excerpt: text.slice(0, 300) } };
    }
    const hits = new Set<string>();
    for (const m of text.matchAll(riskTerms)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
      if (!NEGATED.test(before.slice(before.lastIndexOf(".") + 1))) hits.add(m[0].toLowerCase());
    }
    const facts = { routed_intent: r.intent, excerpt: text.slice(0, 600) };
    if (hits.size > 0) return { verdict: "flag", summary: `${what}: risk indicators ${[...hits].slice(0, 6).join(", ")} (raw answer, heuristic scan).`, facts };
    if (cleanTerms && !cleanTerms.test(text)) {
      return { verdict: "unknown", summary: `${what}: answer did not address the question clearly (raw answer).`, facts };
    }
    return { verdict: "clear", summary: `${what}: no risk indicators in the miner's answer (raw answer, heuristic scan).`, facts };
  };
}

/** Same direction of travel: both adverse, or both clean. Unknowns never count as agreement. */
export function agrees(a: Assessment, b: Assessment): boolean | undefined {
  if (a.verdict === "unknown" || b.verdict === "unknown") return undefined;
  const adverse = (v: Assessment) => v.verdict === "flag" || v.verdict === "block";
  return adverse(a) === adverse(b);
}
