import type { PackDefinition } from "../core/types.ts";
import { commoditiesPack } from "./commodities.ts";
import { exchangePack } from "./exchange.ts";
import { legalPack } from "./legal.ts";
import { startupPack } from "./startup.ts";

export const packs: Record<string, PackDefinition> = {
  exchange: exchangePack,
  commodities: commoditiesPack,
  legal: legalPack,
  startup: startupPack,
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
    if (value && f.type === "date") {
      const date = new Date(value + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        problems.push(`${f.label} must be a valid YYYY-MM-DD date`);
      }
    }
    if (value && f.type === "url") {
      const url = URL.canParse(value) ? new URL(value) : undefined;
      if (!url || url.protocol !== "https:" || url.username || url.password) problems.push(`${f.label} must be an HTTPS URL without credentials`);
      else {
        if (url.href.length > 1000) problems.push(`${f.label} is too long`);
        out[f.name] = url.href;
        continue;
      }
    }
    if (value.length > (f.type === "textarea" ? 4000 : f.type === "url" ? 1000 : 200)) problems.push(`${f.label} is too long`);
    out[f.name] = value;
  }
  if (problems.length) throw Object.assign(new Error(problems.join("; ")), { status: 400 });
  return out;
}
