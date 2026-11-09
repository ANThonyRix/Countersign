import type { CheckSpec, PackDefinition } from "../core/types.ts";
import * as c from "./checks.ts";

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
  ],
  example: {
    seller: "Trafigura Pte Ltd",
    jurisdiction: "Singapore",
    vessel: "EVER GIVEN",
    imo: "9811000",
    port: "Rotterdam",
    document: "",
  },
  subjectName: (s) => `${s.seller} / ${s.vessel}`,
  plan(s) {
    const checks: CheckSpec[] = [
      c.registryCheck(s.seller, s.jurisdiction),
      c.sanctionsCheck(s.seller, "seller"),
      c.sanctionsCheck(s.vessel, "vessel"),
      c.vesselCheck(s.vessel, s.imo || undefined),
      c.portCheck(s.port),
    ];
    if (s.document?.trim()) checks.push(c.documentCheck(s.document.trim(), "bill of lading"));
    return checks;
  },
};
