import type { Assessment, CheckSpec, PackDefinition, PlannedCheck, PublicRecordCheck } from "../core/types.ts";
import { adverseMediaCheck, registryCheck } from "./checks.ts";
import { companiesHouseCheck, companiesHouseCheckId, usesCompaniesHouse } from "./companies-house.ts";

const registry = "https://find-and-update.company-information.service.gov.uk/company/13836904";
const accounts = registry + "/filing-history/MzQ5MzUzOTE4MWFkaXF6a2N4/document";
const acquisition = "https://www.moonpay.com/newsroom/helio-acquisition";
const integration = "https://www.moonpay.com/newsroom/helio";
const referenceCase = {
  entity: "Helio Fintech Ltd",
  jurisdiction: "United Kingdom",
  registration: "13836904",
  website: "https://commerce.moonpay.com/",
  controller: "MoonPay Inc",
  partner: "MoonPay",
  metric: "USD 1.5 billion in processed transactions",
};

const normalize = (text: string) => text.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
const matches = (left: string, right: string) => normalize(left) === normalize(right);

function claim(
  id: string, title: string, input: string, critical: boolean, nextStep: string,
  finding?: { verdict: Assessment["verdict"]; summary: string; source: string; date: string; corroboratingSource?: string },
): PublicRecordCheck {
  return {
    id: "startup:" + id,
    title,
    why: "Compare the submitted claim with the available primary records.",
    critical,
    publicSource: finding?.source,
    recordAssessment: {
      verdict: finding?.verdict ?? "unknown",
      summary: finding?.summary ?? "The available primary records do not establish this claim.",
      facts: { claim: input, sourceDate: finding?.date, corroboratingSource: finding?.corroboratingSource, nextStep },
    },
  };
}

function sourceDiscovery(subject: Record<string, string>): CheckSpec {
  const website = new URL(subject.website).hostname;
  const query = `"${subject.entity}" "${subject.registration}" "${website}" ` +
    "company ownership acquisition filing integration announcement audited usage";
  return {
    id: "startup:source-discovery",
    title: "Public evidence leads",
    why: "Find company filings, counterparty announcements and disclosures for analyst review.",
    intent: "NEWS_SEARCH_GENERAL",
    input: { intent: "NEWS_SEARCH_GENERAL", params: { query } },
    evaluate(response) {
      const result = response.result as { sources?: unknown } | null;
      const items = Array.isArray(result?.sources) ? result.sources : [];
      const sourceCandidates = items
        .map((item: unknown) => typeof item === "string" ? item : (item as { url?: unknown } | null)?.url)
        .filter((url): url is string => typeof url === "string" && url.length <= 1000 && url.startsWith("https://"))
        .slice(0, 5);
      return {
        verdict: "unknown",
        summary: sourceCandidates.length
          ? "The miner returned possible sources. Inspect the original documents before using them to corroborate a claim."
          : "The miner returned no usable source links for this review.",
        facts: { sourceCandidates },
      };
    },
  };
}

export const startupPack: PackDefinition = {
  id: "startup",
  mission: "Startup: investment intelligence",
  title: "Investment claims",
  tagline: "Check a startup’s legal identity, controlling party, product integrations and published metrics before committee review.",
  labels: { GO: "ADVANCE TO DILIGENCE", REVIEW: "NEEDS REVIEW", STOP: "ESCALATE" },
  fields: [
    { name: "entity", label: "Legal entity name", type: "text", required: true },
    { name: "jurisdiction", label: "Registry jurisdiction", type: "text", required: true },
    { name: "registration", label: "Company registration number", type: "text", required: true },
    { name: "website", label: "Public product website", type: "url", required: true },
    { name: "controller", label: "Claimed controlling party", type: "text", required: true, help: "Enter the legal name or Independent. Use public or illustrative information." },
    { name: "partner", label: "Claimed integration partner", type: "text", help: "Optional. Name the partner whose announcement or listing would confirm the integration." },
    { name: "metric", label: "Claimed usage or traction metric", type: "text", help: "Optional. Include the unit and period when known." },
  ],
  example: referenceCase,
  caseStudy: { ...referenceCase, controller: "Independent" },
  subjectName: (s) => s.entity,
  decisionFindings(findings) {
    const registry = findings.find((finding) => finding.checkId === companiesHouseCheckId);
    return registry?.verdict === "clear"
      ? findings.filter((finding) => !(finding.checkId.startsWith("registry:") && finding.verdict === "unknown"))
      : findings;
  },
  async plan(s) {
    const ukRegistry = usesCompaniesHouse(s.jurisdiction);
    const known = matches(s.entity, referenceCase.entity) && s.registration === referenceCase.registration &&
      ukRegistry;
    const controlMatches = matches(s.controller, referenceCase.controller);
    const ownership = claim(
      "controller", "Controlling party", s.controller, true,
      controlMatches && known ? "Obtain a current cap table and confirm the entity that would issue new shares."
        : "Ask for a current cap table, the legal entity raising capital and evidence of rights to the product.",
      known ? {
        verdict: controlMatches ? "clear" : "flag",
        summary: controlMatches
          ? "Filed accounts record that MoonPay Inc acquired 100% of Helio Fintech Ltd on 13 January 2025."
          : "The submitted claim conflicts with the filed accounts, which record that MoonPay Inc acquired 100% of Helio Fintech Ltd on 13 January 2025.",
        source: accounts, date: "2025-12-11", corroboratingSource: acquisition,
      } : undefined,
    );
    const directRegistry = ukRegistry ? await companiesHouseCheck(s.entity, s.registration) : undefined;
    const minerRegistry = registryCheck(s.entity, ukRegistry ? "United Kingdom" : s.jurisdiction, s.registration);
    if (directRegistry) minerRegistry.title = "Telegraph registry lookup";
    if (directRegistry?.recordAssessment.verdict === "clear") minerRegistry.followUps = undefined;
    const checks: PlannedCheck[] = [
      ...(directRegistry ? [directRegistry] : []),
      minerRegistry,
      adverseMediaCheck(s.entity, "fraud OR lawsuit OR regulator fine OR enforcement OR money laundering"),
      ownership,
    ];
    if (!known) checks.push(sourceDiscovery(s));
    if (s.partner) checks.push(claim(
      "integration", "Product integration", s.partner, true,
      "Ask for a current listing or technical documentation showing which product and entity operate the integration.",
      known && matches(s.partner, referenceCase.partner) ? {
        verdict: "clear", summary: "MoonPay announced its integration with Helio Wallet on 4 September 2024.",
        source: integration, date: "2024-09-04",
      } : undefined,
    ));
    if (s.metric) checks.push(claim(
      "metric", "Usage or traction", s.metric, true,
      "Ask for the measurement period, calculation method and independently reconcilable transaction data.",
      known && matches(s.metric, referenceCase.metric) ? {
        verdict: "unknown",
        summary: "MoonPay reported over USD 1.5 billion in processed transactions at acquisition. The published announcement provides no independently reconciled total.",
        source: acquisition, date: "2025-01-13",
      } : undefined,
    ));
    return checks;
  },
};
