import type { CheckSpec, PackDefinition } from "../core/types.ts";
import * as c from "./checks.ts";

const splitList = (v: string | undefined, max: number) =>
  (v ?? "")
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);

export const legalPack: PackDefinition = {
  id: "legal",
  mission: "Legal: multi-jurisdiction diligence",
  title: "Entity diligence across jurisdictions",
  tagline: "One entity, several registries: standing in each jurisdiction, sanctions on the entity and its people, filings and press.",
  labels: { GO: "CLEAR", REVIEW: "REVIEW", STOP: "ESCALATE" },
  fields: [
    { name: "entity", label: "Entity name", type: "text", required: true, placeholder: "Revolut Ltd" },
    { name: "jurisdictions", label: "Jurisdictions", type: "list", required: true, placeholder: "United Kingdom, Lithuania", help: "Comma-separated, up to 3." },
    { name: "people", label: "Directors / UBOs", type: "list", placeholder: "Nikolay Storonsky", help: "Comma-separated, up to 3. Each is sanctions-screened." },
    { name: "period", label: "Filing period", type: "text", placeholder: "last 12 months" },
  ],
  example: {
    entity: "Revolut Ltd",
    jurisdictions: "United Kingdom, Lithuania",
    people: "Nikolay Storonsky",
    period: "last 12 months",
  },
  subjectName: (s) => s.entity,
  plan(s) {
    const jurisdictions = splitList(s.jurisdictions, 3);
    const people = splitList(s.people, 3);
    const checks: CheckSpec[] = [
      ...jurisdictions.map((j) => c.registryCheck(s.entity, j)),
      c.sanctionsCheck(s.entity, "entity"),
      ...people.map((p) => c.sanctionsCheck(p, "officer")),
      c.regulatoryCheck(s.entity, s.period || "last 12 months"),
      c.adverseMediaCheck(s.entity, "fraud OR lawsuit OR regulator fine OR enforcement OR money laundering"),
      c.identityCheck(s.entity, jurisdictions),
    ];
    return checks;
  },
};
