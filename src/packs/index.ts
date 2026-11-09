import type { PackDefinition } from "../core/types.ts";
import { commoditiesPack } from "./commodities.ts";
import { exchangePack } from "./exchange.ts";
import { legalPack } from "./legal.ts";

export const packs: Record<string, PackDefinition> = {
  exchange: exchangePack,
  commodities: commoditiesPack,
  legal: legalPack,
};

export function getPack(id: string): PackDefinition {
  const pack = packs[id];
  if (!pack) throw Object.assign(new Error(`unknown pack "${id}". Available: ${Object.keys(packs).join(", ")}`), { status: 400 });
  return pack;
}

/** Validates and normalises a subject against the pack's field definitions. */
export function normaliseSubject(pack: PackDefinition, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const problems: string[] = [];
  for (const f of pack.fields) {
    const v = raw[f.name];
    const value = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
    if (f.required && !value) problems.push(`${f.label} is required`);
    if (value && f.type === "address" && !/^0x[0-9a-fA-F]{40}$/.test(value)) problems.push(`${f.label} must be a 0x address`);
    if (value.length > (f.type === "textarea" ? 4000 : 200)) problems.push(`${f.label} is too long`);
    out[f.name] = value;
  }
  if (problems.length) throw Object.assign(new Error(problems.join("; ")), { status: 400 });
  return out;
}
