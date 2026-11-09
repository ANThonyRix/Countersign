// Reusable check builders. Each one maps a diligence question to one Telegraph intent.
import * as ev from "../core/evaluators.ts";
import type { Assessment, CheckSpec } from "../core/types.ts";
import type { AskResponse } from "../telegraph/types.ts";

// Countries a headquarters string may name, with the common ways miners write them. Only a country named
// here and absent from the review counts as "outside": a bare city ("London") is never a flag.
const COUNTRY_ALIASES: Record<string, string[]> = {
  "united kingdom": ["united kingdom", "uk", "england", "scotland", "wales", "great britain", "london"],
  "united states": ["united states", "usa", "u.s.", "new york", "san francisco", "delaware"],
  singapore: ["singapore"],
  switzerland: ["switzerland", "geneva", "zurich", "zug"],
  netherlands: ["netherlands", "amsterdam", "rotterdam"],
  germany: ["germany", "berlin", "frankfurt", "munich"],
  france: ["france", "paris"],
  ireland: ["ireland", "dublin"],
  lithuania: ["lithuania", "vilnius"],
  "united arab emirates": ["united arab emirates", "uae", "dubai", "abu dhabi"],
  "hong kong": ["hong kong"],
  china: ["china", "beijing", "shanghai", "shenzhen"],
  japan: ["japan", "tokyo"],
  india: ["india", "mumbai", "bangalore"],
  canada: ["canada", "toronto"],
  australia: ["australia", "sydney"],
  russia: ["russia", "moscow"],
  cyprus: ["cyprus", "limassol"],
  malta: ["malta"],
  "cayman islands": ["cayman islands", "cayman"],
  "british virgin islands": ["british virgin islands", "bvi"],
};

// Aliases can come from user input (an unlisted jurisdiction), so every regex metacharacter is escaped.
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, alias: string) => new RegExp(`(^|[^a-z])${escapeRegExp(alias)}($|[^a-z])`).test(text);

/** True unless the headquarters string names a known country that is not under review. */
export function hqInScope(headquarters: string, expectedJurisdictions: string[]): boolean {
  const hq = headquarters.toLowerCase();
  if (!hq.trim()) return true;
  const expected = expectedJurisdictions.map((j) => j.toLowerCase());
  const aliasesOf = (country: string) => COUNTRY_ALIASES[country] ?? [country];
  if (expected.some((j) => aliasesOf(j).some((a) => mentions(hq, a)))) return true;
  const named = Object.keys(COUNTRY_ALIASES).filter((c) => aliasesOf(c).some((a) => mentions(hq, a)));
  return named.length === 0;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function sanctionsCheck(name: string, role: string, follow = true): CheckSpec {
  return {
    id: `sanctions:${slug(role)}:${slug(name)}`,
    title: `Sanctions screen: ${name}`,
    why: `A sanctioned ${role} ends the deal. Screened against consolidated sanctions lists.`,
    intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
    input: { intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name } },
    critical: true,
    evaluate: ev.sanctions(name),
    followUps: follow
      ? (a) =>
          a.verdict === "block" || a.verdict === "flag"
            ? [newsCheck(`${name} sanctions OFAC designation`, name, `Sanctions hit on ${role}: look for public designation reporting.`, "sanctions-press")]
            : []
      : undefined,
  };
}

export function registryCheck(company: string, jurisdiction: string, follow = true): CheckSpec {
  return {
    id: `registry:${slug(jurisdiction)}:${slug(company)}`,
    title: `Registry lookup: ${company} (${jurisdiction})`,
    why: `Confirms the legal entity exists and is in good standing in ${jurisdiction}.`,
    intent: "CORPORATE_REGISTRY_LOOKUP_GENERAL",
    input: { intent: "CORPORATE_REGISTRY_LOOKUP_GENERAL", params: { company, jurisdiction } },
    critical: true,
    evaluate: ev.registry(company, jurisdiction),
    followUps: follow
      ? (a) =>
          a.verdict === "block" || a.verdict === "unknown"
            ? [
                newsCheck(
                  `${company} ${jurisdiction} dissolved OR liquidation OR shell company OR fraud`,
                  company,
                  `Registry record missing or inactive in ${jurisdiction}: look for dissolution, liquidation or shell-company reporting.`,
                  `registry-${slug(jurisdiction)}`,
                ),
              ]
            : []
      : undefined,
  };
}

export function newsCheck(query: string, subject: string, why: string, tag = "adverse"): CheckSpec {
  return {
    id: `news:${tag}:${slug(subject)}`,
    title: `Adverse media: ${subject}${tag === "adverse" ? "" : ` (${tag.replace(/-/g, " ")})`}`,
    why,
    intent: "NEWS_SEARCH_GENERAL",
    input: { intent: "NEWS_SEARCH_GENERAL", params: { query } },
    evaluate: ev.adverseMedia(subject),
  };
}

export function adverseMediaCheck(subject: string, terms: string): CheckSpec {
  return newsCheck(`"${subject}" ${terms}`, subject, "Public reporting of fraud, enforcement or litigation changes the risk picture.");
}

export function botCheck(account: string, project: string): CheckSpec {
  return {
    id: `social:${slug(account)}`,
    title: `Audience authenticity: ${account}`,
    why: "Bought or automated followers are a common sign of a pump-and-dump listing.",
    intent: "SOCIAL_BOT_DETECTION_GENERAL",
    input: { intent: "SOCIAL_BOT_DETECTION_GENERAL", params: { account } },
    evaluate: ev.botDetection(account),
    followUps: (a) =>
      a.verdict === "flag"
        ? [newsCheck(`"${project}" fake followers OR bot accounts OR wash trading OR pump and dump`, project, "Automated audience detected: look for reports of market manipulation.", "manipulation")]
        : [],
  };
}

export function documentCheck(document: string, label: string): CheckSpec {
  return {
    id: `document:${slug(label)}`,
    title: `Document authenticity: ${label}`,
    why: "A forged trade document is the core of most cargo fraud.",
    intent: "DOCUMENT_AUTHENTICITY_GENERAL",
    input: { intent: "DOCUMENT_AUTHENTICITY_GENERAL", params: { document } },
    critical: true,
    evaluate: ev.documentAuthenticity(),
  };
}

export function portCheck(port: string): CheckSpec {
  return {
    id: `port:${slug(port)}`,
    title: `Port congestion: ${port}`,
    why: "Congestion at the discharge port drives delay and demurrage exposure.",
    intent: "LIVE_PORT_CONGESTION_GENERAL",
    input: { intent: "LIVE_PORT_CONGESTION_GENERAL", params: { port } },
    evaluate: ev.portCongestion(port),
  };
}

export function codeReviewCheck(code: string): CheckSpec {
  return {
    id: "code:contract-source",
    title: "Source code review",
    why: "Reviews the submitted contract source for privileged or unsafe logic.",
    intent: "CODE_REVIEW_GENERAL",
    input: { intent: "CODE_REVIEW_GENERAL", params: { code: code.slice(0, 2000) } },
    evaluate: ev.codeReview(),
  };
}

export function balanceCheck(address: string, block: number, label: string): CheckSpec {
  return {
    id: `onchain:${slug(label)}`,
    title: `${label} balance at block ${block}`,
    why: "Confirms the stated treasury actually holds funds, pinned to a block.",
    intent: "ONCHAIN_METRIC_VERIFY_GENERAL",
    input: { intent: "ONCHAIN_METRIC_VERIFY_GENERAL", params: { address, block } },
    evaluate: ev.onchainBalance(address),
  };
}

export function identityCheck(company: string, expectedJurisdictions: string[]): CheckSpec {
  return {
    id: `identity:${slug(company)}`,
    title: `Business identity: ${company}`,
    why: "Cross-checks the operating footprint (domain, size, HQ) against the registered entity.",
    intent: "B2B_IDENTITY_ENRICHMENT_GENERAL",
    input: { intent: "B2B_IDENTITY_ENRICHMENT_GENERAL", params: { company } },
    evaluate: (r: AskResponse): Assessment => {
      const res = r.result_shape === "intent" ? (r.result as Record<string, unknown>) : undefined;
      if (!res || (r.field_status?.domain !== "ok" && r.field_status?.headquarters !== "ok")) {
        return { verdict: "unknown", summary: `No business identity data found for "${company}".` };
      }
      const facts = { domain: res.domain, industry: res.industry, headquarters: res.headquarters, employee_count: res.employee_count };
      const inScope = hqInScope(String(res.headquarters ?? ""), expectedJurisdictions);
      const desc = [res.domain, res.industry, res.headquarters && `HQ ${res.headquarters}`, res.employee_count != null && `${res.employee_count} employees`]
        .filter(Boolean)
        .join(", ");
      if (!inScope) {
        return { verdict: "flag", summary: `"${company}" operates from ${res.headquarters}, outside the jurisdictions under review (${expectedJurisdictions.join(", ")}).`, facts };
      }
      return { verdict: "clear", summary: `"${company}": ${desc}.`, facts };
    },
  };
}

export function regulatoryCheck(entity: string, period: string): CheckSpec {
  return {
    id: `filings:${slug(entity)}`,
    title: `Regulatory filings: ${entity} (${period})`,
    why: "Recent filings show regulatory exposure, enforcement and reporting discipline.",
    intent: "REGULATORY_FILING_MONITOR_GENERAL",
    input: { intent: "REGULATORY_FILING_MONITOR_GENERAL", params: { entity, period } },
    evaluate: (r: AskResponse): Assessment => {
      const res = r.result_shape === "intent" ? (r.result as Record<string, unknown>) : undefined;
      if (!res || r.field_status?.filing_count !== "ok") return { verdict: "unknown", summary: `Filing count for "${entity}" could not be read.` };
      const facts = { filing_count: res.filing_count, filings: res.filings, urls: res.urls };
      const text = JSON.stringify(res.filings ?? "").toLowerCase();
      if (/enforcement|cease|penalt|consent order|warning letter|litigation release|sanction/.test(text)) {
        return { verdict: "flag", summary: `${res.filing_count} filings for "${entity}" in ${period}, including enforcement-type filings.`, facts };
      }
      return { verdict: "clear", summary: `${res.filing_count} regulatory filings for "${entity}" in ${period}; no enforcement-type filings seen.`, facts };
    },
  };
}

const CONTRACT_RISK =
  /\b(honeypot|rug[- ]?pull|backdoor|blacklist\w*|unlimited mint\w*|mint(able)? by owner|owner can mint|can mint|pausable|pause transfers?|upgradeable proxy|proxy upgrade|self[- ]?destruct|reentran\w*|high[- ]severity|critical (issue|vulnerabilit\w*|finding)s?|hidden fee|fee manipulation|trading disabled|cannot sell|sell tax)\b/gi;

export function contractAuditCheck(address: string, chain: string): CheckSpec {
  return {
    id: `contract:${slug(address)}`,
    title: `Contract risk audit: ${address.slice(0, 10)}…`,
    why: "Honeypots, owner mint and upgrade backdoors are the main ways listed tokens hurt users.",
    intent: "SMART_CONTRACT_AUDIT_GENERAL",
    pinIntent: true,
    critical: true,
    input: {
      query: `Audit the ERC-20 token contract ${address} on ${chain}. Report honeypot behaviour, owner or minter privileges, blacklist or pause functions, proxy upgradeability, transfer fees, and any high or critical severity issues.`,
    },
    evaluate: ev.rawRiskScan("Contract audit", CONTRACT_RISK, /contract|token|function|owner|audit|risk/i),
  };
}

const VESSEL_RISK =
  /\b(ais (gap|off|dark|spoof\w*)|dark (activity|period|voyage)|went dark|spoof\w*|sanction\w*|ship[- ]to[- ]ship|sts transfer|flag[- ]hopp\w*|identity (change|mismatch)|position (mismatch|jump)|not found|unknown vessel|no ais)\b/gi;

export function vesselCheck(vessel: string, imo?: string): CheckSpec {
  const ref = imo ? `${vessel} (IMO ${imo})` : vessel;
  return {
    id: `vessel:${slug(imo || vessel)}`,
    title: `Vessel telemetry: ${ref}`,
    why: "Confirms the named ship exists, is where the seller says, and has no AIS dark periods.",
    intent: "VESSEL_TELEMETRY_VERIFY_GENERAL",
    pinIntent: true,
    critical: true,
    input: {
      query: `Verify live AIS telemetry for the vessel ${ref}: current position, speed, course, destination and last report time, and whether there are AIS gaps, dark periods or identity mismatches.`,
    },
    evaluate: ev.rawRiskScan("Vessel telemetry", VESSEL_RISK, /lat|lon|position|speed|course|mmsi|imo|destination|vessel/i),
  };
}
