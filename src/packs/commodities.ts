import type { PackDefinition, PlannedCheck, PublicRecordCheck } from "../core/types.ts";
import { registrationKey } from "../core/evaluators.ts";
import * as c from "./checks.ts";

function supplierIdentity(s: Record<string, string>): PublicRecordCheck {
  const claimed = registrationKey(s["seller-id"] || "");
  const recorded = registrationKey(s["record-seller-id"] || "");
  const complete = claimed && recorded && s["supplier-source"];
  const matches = complete && claimed === recorded;
  return {
    id: "record:supplier-id",
    title: "Supplier registration number",
    why: "Compare the supplier's claimed registration number with a cited public record supplied for this review.",
    critical: true,
    publicSource: s["supplier-source"] || undefined,
    recordAssessment: {
      verdict: !complete ? "unknown" : matches ? "clear" : "flag",
      summary: !complete
        ? "Request the supplier's registration number and a public record with the registered number before paying."
        : matches
          ? `Claimed registration ${s["seller-id"]} matches the cited number ${s["record-seller-id"]}.`
          : `Claimed registration ${s["seller-id"]} differs from the cited number ${s["record-seller-id"]}. Confirm the invoicing entity before paying.`,
    },
  };
}

function arrivalDeadline(s: Record<string, string>): PublicRecordCheck {
  const deadline = s["arrival-deadline"];
  const observed = s["record-arrival"];
  const imo = (value: string) => value.replace(/^IMO\s*/i, "").trim();
  const sameVessel = /^\d{7}$/.test(imo(s.imo || "")) && imo(s.imo) === imo(s["record-imo"] || "");
  const samePort = s.port?.trim().toLowerCase() === s["record-port"]?.trim().toLowerCase();
  const inScope = sameVessel && samePort && s["voyage-departure"] && observed >= s["voyage-departure"];
  const usable = deadline && observed && s["arrival-source"] && inScope && deadline >= s["voyage-departure"];
  const late = usable && observed > deadline;
  const daysLate = late ? (Date.parse(observed) - Date.parse(deadline)) / 86_400_000 : 0;
  return {
    id: "record:arrival",
    title: "Arrival against buyer deadline",
    why: "Compare the buyer's required port arrival with the supplied terminal record for the nominated vessel. Port arrival does not establish cargo delivery.",
    critical: true,
    publicSource: s["arrival-source"] || undefined,
    recordAssessment: {
      verdict: !usable ? "unknown" : late ? "flag" : "clear",
      summary: !usable
        ? "Request a terminal arrival record for the nominated IMO, destination and voyage, and confirm the buyer's arrival deadline."
        : late
          ? `Cited arrival at ${s.port} was ${observed}, ${daysLate} days after the required ${deadline}. Hold payment pending a revised delivery plan or buyer approval.`
          : `Cited arrival at ${s.port} was ${observed}, within the required ${deadline}.`,
    },
  };
}

export const commoditiesPack: PackDefinition = {
  id: "commodities",
  mission: "Commodities: cargo and counterparty",
  title: "Cargo counterparty check",
  tagline: "Before you pay for the cargo: is the seller real, is the ship real and clean, is the paperwork genuine, can it discharge on time?",
  labels: { GO: "PROCEED", REVIEW: "HOLD", STOP: "BLOCK" },
  fields: [
    { name: "seller", label: "Seller company", type: "text", required: true, placeholder: "Trafigura Pte Ltd" },
    { name: "jurisdiction", label: "Seller jurisdiction", type: "text", required: true, placeholder: "Singapore" },
    { name: "vessel", label: "Vessel name", type: "text", required: true, placeholder: "EVER GIVEN" },
    { name: "imo", label: "IMO number", type: "text", placeholder: "9811000" },
    { name: "port", label: "Discharge port", type: "text", required: true, placeholder: "Rotterdam" },
    { name: "document", label: "Bill of lading (text or link)", type: "textarea", placeholder: "Paste the B/L text or a link to it (optional)" },
    { name: "cargo", label: "Goods being sourced", type: "text", tradeDetail: true },
    { name: "load-port", label: "Loading port", type: "text", tradeDetail: true },
    { name: "voyage-departure", label: "Voyage departure date", type: "date", tradeDetail: true },
    { name: "carrier", label: "Shipping line", type: "text", tradeDetail: true },
    { name: "vessel-manager", label: "Vessel manager", type: "text", tradeDetail: true },
    { name: "vessel-source", label: "Vessel or voyage record URL", type: "url", tradeDetail: true },
    { name: "seller-id", label: "Claimed seller registration number", type: "text", tradeDetail: true },
    { name: "record-seller-id", label: "Registration number in public record", type: "text", tradeDetail: true },
    { name: "supplier-source", label: "Supplier record URL", type: "url", tradeDetail: true },
    { name: "arrival-deadline", label: "Buyer’s latest port arrival date", type: "date", tradeDetail: true },
    { name: "record-arrival", label: "Arrival date in terminal record", type: "date", tradeDetail: true },
    { name: "record-imo", label: "IMO matched to terminal record", type: "text", tradeDetail: true },
    { name: "record-port", label: "Port in terminal record", type: "text", tradeDetail: true },
    { name: "arrival-source", label: "Terminal record URL", type: "url", tradeDetail: true },
  ],
  example: {
    seller: "Trafigura Pte Ltd",
    jurisdiction: "Singapore",
    vessel: "EVER GIVEN",
    imo: "9811000",
    port: "Rotterdam",
    document: "",
  },
  caseStudy: {
    seller: "Scientex Berhad",
    jurisdiction: "Malaysia",
    vessel: "EVER GIVEN",
    imo: "9811000",
    port: "Rotterdam",
    cargo: "Packaging film (illustrative order)",
    "load-port": "Tanjung Pelepas, Malaysia",
    "voyage-departure": "2021-03-13",
    carrier: "Evergreen Marine Corporation",
    "vessel-manager": "Bernhard Schulte Shipmanagement (Hong Kong) Limited Partnership",
    "vessel-source": "https://gcaptain.com/wp-content/uploads/2023/07/Final-Investigation-Report-Ever-Given-23-March-2021.pdf",
    "seller-id": "196801000264",
    "record-seller-id": "196801000264",
    "supplier-source": "https://scientex.com.my/wp-content/uploads/2021/06/SBQ3FY2021.pdf",
    "arrival-deadline": "2021-04-15",
    "record-arrival": "2021-07-29",
    "record-imo": "9811000",
    "record-port": "Rotterdam",
    "arrival-source": "https://www.ect.nl/en/news/news-feed/ever-given-arrived-at-ect-delta-terminal",
  },
  subjectName: (s) => `${s.seller} / ${s.vessel}`,
  plan(s) {
    const checks: PlannedCheck[] = [
      c.registryCheck(s.seller, s.jurisdiction, s["seller-id"] || undefined),
      c.sanctionsCheck(s.seller, "seller"),
      c.sanctionsCheck(s.vessel, "vessel"),
      c.vesselCheck(s.vessel, s.imo || undefined),
      c.portCheck(s.port),
    ];
    if (s.carrier) checks.push(c.sanctionsCheck(s.carrier, "shipping line"));
    if (s["vessel-manager"]) checks.push(c.sanctionsCheck(s["vessel-manager"], "vessel manager"));
    if (s.document?.trim()) checks.push(c.documentCheck(s.document.trim(), "bill of lading"));
    if (s["seller-id"] || s["record-seller-id"] || s["supplier-source"]) checks.push(supplierIdentity(s));
    if (s["arrival-deadline"] || s["record-arrival"] || s["arrival-source"]) checks.push(arrivalDeadline(s));
    if (s.cargo) {
      checks.push({
        id: "record:cargo-link",
        title: "Cargo linked to the voyage",
        why: "An arrival record establishes a port call. A cargo document is needed to associate the buyer's goods with it.",
        critical: true,
        recordAssessment: {
          verdict: "unknown",
          summary: s.document
            ? "Confirm the supplied document identifies the seller, goods, vessel and voyage before paying. The authenticity check alone cannot establish this link."
            : "Request a bill of lading or carrier booking that identifies the seller, goods, vessel and voyage before paying.",
        },
      });
    }
    return checks;
  },
};
