import type { Decision, Finding } from "./types.ts";

export interface PolicyResult {
  decision: Decision;
  reasons: string[];
  coverage: { total: number; answered: number; unknown: number; skipped: number };
}

/**
 * Deterministic decision rule. The agent never lets a model decide the outcome:
 *  - STOP   when a block-level finding is confirmed by a second miner, or is not critical
 *           (non-critical blocks come from deterministic sources).
 *  - REVIEW when any finding is adverse but unconfirmed, any critical check is unknown,
 *           miners disagree, or less than two thirds of the plan was answered.
 *  - GO     otherwise.
 */
export function decide(findings: Finding[]): PolicyResult {
  const total = findings.length;
  const skipped = findings.filter((f) => f.skipped).length;
  const unknown = findings.filter((f) => f.verdict === "unknown").length;
  const answered = total - unknown;
  const coverage = { total, answered, unknown, skipped };

  const stop: string[] = [];
  const review: string[] = [];

  for (const f of findings) {
    if (f.verdict === "block") {
      if (f.corroboration === "confirmed" || !f.critical) stop.push(f.summary);
      else if (f.corroboration === "disputed") review.push(`Miners disagree: ${f.summary}`);
      else review.push(`Unconfirmed: ${f.summary}`);
    } else if (f.verdict === "flag") {
      review.push(f.corroboration === "disputed" ? `Miners disagree: ${f.summary}` : f.summary);
    } else if (f.verdict === "unknown" && f.critical) {
      review.push(f.skipped ? `Not checked (${f.skipped}): ${f.title}` : `No usable answer: ${f.title}`);
    } else if (f.verdict === "clear" && f.corroboration === "disputed") {
      review.push(`Miners disagree: ${f.title}`);
    }
  }

  if (total > 0 && answered / total < 2 / 3) review.push(`Only ${answered} of ${total} checks returned a usable answer.`);

  if (stop.length) return { decision: "STOP", reasons: [...stop, ...review], coverage };
  if (review.length) return { decision: "REVIEW", reasons: review, coverage };
  const gap = total - answered;
  const why = gap === 0
    ? `All ${total} checks came back clean.`
    : `Every answered check came back clean; ${gap} non-critical ${gap === 1 ? "check" : "checks"} returned no usable answer.`;
  return { decision: "GO", reasons: [why], coverage };
}
