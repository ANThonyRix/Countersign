import type { AskInput, AskResponse, FieldStatus, TelegraphReceipt } from "../telegraph/types.ts";

/** Outcome of one check, from the agent's point of view. */
export type Verdict = "clear" | "flag" | "block" | "unknown";

/** How many independent miners stand behind a finding. */
export type Corroboration = "single" | "confirmed" | "disputed" | "not_needed";

export type Decision = "GO" | "REVIEW" | "STOP";

export interface Assessment {
  verdict: Verdict;
  summary: string;
  facts?: Record<string, unknown>;
}

export interface CheckSpec {
  /** Unique within a run, e.g. "sanctions:seller". */
  id: string;
  title: string;
  /** Why the agent buys this check, shown in the memo. */
  why: string;
  intent: string;
  input: AskInput;
  /**
   * Intents with no input schema take a free-form query. With `pinIntent` the agent
   * sends it straight to ranked miners of this intent instead of letting the router guess.
   */
  pinIntent?: boolean;
  /** Critical checks get a second, independent miner whenever the first answer is not clean. */
  critical?: boolean;
  /** Set by the planner when the check was bought because of an earlier finding. */
  escalatedFrom?: string;
  evaluate(response: AskResponse): Assessment;
  /** Follow-up checks the agent decides to buy after seeing this result. */
  followUps?(assessment: Assessment, response: AskResponse): CheckSpec[];
}

export interface Evidence {
  id: string;
  checkId: string;
  role: "primary" | "crosscheck";
  intent: string;
  routedIntent?: string;
  minerId?: string;
  minerName?: string;
  signalHash?: string;
  receipt?: TelegraphReceipt;
  costUsd: number;
  durationMs?: number;
  resultShape?: string;
  fieldStatus?: Record<string, FieldStatus>;
  result?: unknown;
  reasoning?: string;
  at: string;
  verdict?: Verdict;
  error?: string;
  verification?: { found: boolean; nodeVerified: boolean; localHashMatch: boolean; payerMatches: boolean };
}

export interface Finding {
  checkId: string;
  title: string;
  why: string;
  verdict: Verdict;
  summary: string;
  facts?: Record<string, unknown>;
  critical: boolean;
  corroboration: Corroboration;
  evidence: string[];
  escalatedFrom?: string;
  skipped?: string;
}

export type FieldType = "text" | "textarea" | "address" | "list";

export interface PackField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export interface PackDefinition {
  id: "exchange" | "commodities" | "legal";
  mission: string;
  title: string;
  tagline: string;
  /** Decision labels shown to the desk that uses this pack. */
  labels: Record<Decision, string>;
  fields: PackField[];
  example: Record<string, string>;
  subjectName(subject: Record<string, string>): string;
  plan(subject: Record<string, string>, ctx: PlanContext): Promise<CheckSpec[]> | CheckSpec[];
}

export interface PlanContext {
  /** Latest Ethereum mainnet block, for checks that pin a balance to a block. */
  latestBlock?: () => Promise<number>;
}

export type AgentEvent =
  | { type: "plan"; checks: { id: string; title: string; intent: string; critical: boolean }[]; estimateUsd: number }
  | { type: "check_start"; checkId: string; title: string; role: "primary" | "crosscheck"; miner?: string }
  | { type: "evidence"; evidence: Evidence }
  | { type: "finding"; finding: Finding }
  | { type: "escalate"; from: string; checks: { id: string; title: string }[]; reason: string }
  | { type: "skip"; checkId: string; reason: string }
  | { type: "verify"; evidenceId: string; ok: boolean }
  | { type: "decision"; decision: Decision; label: string; reasons: string[] }
  | { type: "memo"; memoId: string }
  | { type: "error"; message: string };
