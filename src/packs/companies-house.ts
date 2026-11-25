import type { Assessment, PublicRecordCheck } from "../core/types.ts";

export const companiesHouseCheckId = "startup:registered-entity";
const registry = "https://find-and-update.company-information.service.gov.uk/company/";
const dataService = "https://data.companieshouse.gov.uk/doc/company/";
const jurisdictions = new Set([
  "united kingdom", "uk", "gb", "great britain", "england", "wales", "england and wales",
  "england & wales", "scotland", "northern ireland",
]);

export function usesCompaniesHouse(jurisdiction: string): boolean {
  return jurisdictions.has(jurisdiction.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim());
}

function legalName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ").replace(/\b(?:limited|ltd\.?)$/, "ltd");
}

interface CompanyRecord {
  CompanyName?: unknown;
  CompanyNumber?: unknown;
  CompanyStatus?: unknown;
}

export async function companiesHouseCheck(name: string, registration: string): Promise<PublicRecordCheck> {
  const number = registration.toUpperCase();
  const valid = /^[A-Z0-9]{8}$/.test(number);
  const publicSource = valid ? registry + number : undefined;
  return {
    id: companiesHouseCheckId,
    title: "Companies House record",
    why: "Check the submitted company name and number against the official UK register.",
    critical: true,
    publicSource,
    recordAssessment: valid
      ? await lookUpCompany(name, number)
      : { verdict: "unknown", summary: "Enter the eight-character Companies House registration number, including any leading zeros or letters." },
  };
}

async function lookUpCompany(name: string, number: string): Promise<Assessment> {
  const unknown = (summary: string): Assessment => ({ verdict: "unknown", summary });
  try {
    const response = await fetch(dataService + number + ".json", {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return unknown(`Companies House returned no record for ${number}. Check the submitted number.`);
    if (!response.ok) return unknown(`The Companies House lookup returned HTTP ${response.status}. Check the official record or retry.`);
    const { primaryTopic } = await response.json() as { primaryTopic?: CompanyRecord };
    const recordedName = primaryTopic?.CompanyName;
    const status = primaryTopic?.CompanyStatus;
    if (primaryTopic?.CompanyNumber !== number || typeof recordedName !== "string" || !recordedName.trim() ||
      typeof status !== "string" || !status.trim()) {
      return unknown("Companies House returned an incomplete or inconsistent record. Review the official company page.");
    }
    const facts = { registryName: recordedName, registration: number, registryStatus: status, checkedAt: new Date().toISOString() };
    if (legalName(recordedName) !== legalName(name)) {
      return { verdict: "flag", summary: `Companies House lists ${number} as "${recordedName}" (status: ${status}). Confirm the submitted legal name and registration number.`, facts };
    }
    return status.trim().toLowerCase() === "active"
      ? { verdict: "clear", summary: `Companies House confirms "${recordedName}" (${number}) is Active.`, facts }
      : { verdict: "flag", summary: `Companies House confirms the entity and reports its status as ${status}. Review the status before advancing.`, facts };
  } catch {
    return unknown("The Companies House lookup could not be completed. Check the official record or retry.");
  }
}
