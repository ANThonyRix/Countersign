import type { Finding, PaymentConditionReview, PublicRecordCheck } from "../core/types.ts";
import { registrationKey } from "../core/evaluators.ts";

type RecordFields = Record<string, unknown>;
type Comparison = { field: string; expected: string; observed: string };

const packetField = "order-packet";
const conditionIds = ["order:booking", "order:shipment", "order:deadline"] as const;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const identifier = (value: unknown) => text(value).toUpperCase();
const container = (value: unknown) => {
  const code = identifier(value).replace(/[\s-]/g, "");
  return /^[A-Z]{3}U\d{7}$/.test(code) ? code : "";
};
const imo = (value: unknown) => {
  const code = identifier(value).replace(/^IMO\s*/, "");
  return /^\d{7}$/.test(code) ? code : "";
};
const kilograms = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : "";
const date = (value: unknown) => {
  const input = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return "";
  const parsed = new Date(input + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input ? input : "";
};

function record(value: unknown): RecordFields {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordFields : {};
}

function parsePacket(raw: string): RecordFields {
  try {
    return record(JSON.parse(raw));
  } catch {
    return {};
  }
}

function comparison(field: string, expected: string, observed: string): Comparison {
  return { field, expected, observed };
}

function relatedRecords(
  id: string, title: string, comparisons: Comparison[], sources: string[], next: string,
): PublicRecordCheck {
  const mismatch = comparisons.find(({ expected, observed }) => expected && observed && expected !== observed);
  const missing = comparisons.find(({ expected, observed }) => !expected || !observed);
  const verdict = mismatch ? "flag" : missing || sources.some((source) => !source) ? "unknown" : "clear";
  return {
    id, title, why: "Reconcile the values in the supplied records for this order.", critical: true,
    evidenceKind: "order-document",
    recordAssessment: {
      verdict,
      summary: mismatch
        ? `${mismatch.field}: expected ${mismatch.expected}, found ${mismatch.observed}. ${next}`
        : verdict === "unknown"
          ? `${missing ? `Missing or invalid ${missing.field.toLowerCase()}.` : "Missing a document reference."} ${next}`
          : "The required values match across the cited records.",
      facts: { comparisons, sources },
    },
  };
}

export function paymentChecks(s: Record<string, string>): PublicRecordCheck[] {
  if (!s[packetField]) return [];

  const packet = parsePacket(s[packetField]);
  const order = record(packet.purchaseOrder);
  const booking = record(packet.billOfLading);
  const discharge = record(packet.discharge);
  const orderReference = text(order.reference);
  const bookingReference = text(booking.reference);
  const dischargeReference = text(discharge.reference);
  const reconciliation = relatedRecords(conditionIds[0], "Order matches bill of lading", [
    comparison("Order number", identifier(order.id), identifier(booking.orderId)),
    comparison("Seller registration number", registrationKey(s["seller-id"] || ""), registrationKey(text(order.sellerRegistration))),
    comparison("Bill of lading seller", registrationKey(text(order.sellerRegistration)), registrationKey(text(booking.sellerRegistration))),
    comparison("Product SKU", identifier(order.sku), identifier(booking.sku)),
    comparison("Quantity (kg)", kilograms(order.quantityKg), kilograms(booking.quantityKg)),
  ], [orderReference, bookingReference], "Request a corrected bill of lading that identifies this order and its goods.");
  const shipment = relatedRecords(conditionIds[1], "Booked container matches discharge record", [
    comparison("Bill of lading number", identifier(booking.id), identifier(discharge.billOfLadingId)),
    comparison("Container number", container(booking.container), container(discharge.container)),
    comparison("Booked vessel IMO", imo(s.imo), imo(booking.imo)),
    comparison("Discharge vessel IMO", imo(booking.imo), imo(discharge.imo)),
    comparison("Booked voyage number", identifier(s["voyage-number"]), identifier(booking.voyage)),
    comparison("Discharge voyage number", identifier(booking.voyage), identifier(discharge.voyage)),
    comparison("Agreed discharge port", identifier(s.port), identifier(order.dischargePort)),
    comparison("Recorded discharge port", identifier(order.dischargePort), identifier(discharge.port)),
  ], [bookingReference, dischargeReference, s["vessel-source"] || ""], "Request a terminal discharge record for the container, bill of lading and voyage on this order.");
  const deadline = date(order.dischargeBy);
  const dischargedOn = date(discharge.dischargedOn);
  const departure = date(s["voyage-departure"]);
  const arrival = imo(s["record-imo"]) === imo(booking.imo) && identifier(s["record-port"]) === identifier(discharge.port)
    ? date(s["record-arrival"]) : "";
  const match = shipment.recordAssessment.verdict === "clear";
  const validDate = dischargedOn && (!departure || dischargedOn >= departure) && (!arrival || dischargedOn >= arrival);
  const late = !!(validDate && deadline && dischargedOn > deadline);
  const verdict = !match || !validDate || !deadline || !orderReference ? "unknown" : late ? "flag" : "clear";
  return [reconciliation, shipment, {
    id: conditionIds[2],
    title: "Container discharged by payment deadline",
    why: "The buyer requires discharge of the matched container by the agreed calendar date at the destination port.",
    critical: true,
    evidenceKind: "order-document",
    recordAssessment: {
      verdict,
      summary: verdict === "unknown"
        ? "Confirm the deadline and provide a valid discharge date for the booked container and voyage."
        : late
          ? `Discharged on ${dischargedOn}, after the required ${deadline}. Ask the buyer to review the late delivery before payment.`
          : `Discharged on ${dischargedOn}, by the required ${deadline}.`,
      facts: { comparisons: [comparison("Discharge by", deadline, dischargedOn)], sources: [orderReference, dischargeReference] },
    },
  }];
}

export function paymentConditionReview(s: Record<string, string>, findings: Finding[]): PaymentConditionReview | undefined {
  if (!s[packetField]) return undefined;
  return {
    basis: parsePacket(s[packetField]).mode === "illustrative" ? "illustrative" : "supplied",
    document_decision: conditionIds.every((id) => findings.some((finding) => finding.checkId === id && finding.verdict === "clear"))
      ? "PROCEED" : "HOLD",
  };
}

export function illustrativeOrder(outcome: "hold" | "proceed"): string {
  return JSON.stringify({
    mode: "illustrative",
    purchaseOrder: {
      reference: "Illustrative buyer purchase order and payment terms",
      id: "DEMO-PO-011W", sellerRegistration: "196801000264", sku: "FILM-01", quantityKg: 1000,
      dischargePort: "Rotterdam", dischargeBy: "2021-07-31",
    },
    billOfLading: {
      reference: "Illustrative carrier bill of lading",
      id: "DEMO-BL-011W", orderId: "DEMO-PO-011W", sellerRegistration: "196801000264",
      sku: "FILM-01", quantityKg: 1000, container: "TGHU1234567", imo: "9811000", voyage: "011W",
    },
    discharge: {
      reference: "Illustrative terminal discharge record",
      billOfLadingId: "DEMO-BL-011W", container: outcome === "hold" ? "TGHU1234572" : "TGHU1234567",
      imo: "9811000", voyage: "011W", port: "Rotterdam", dischargedOn: "2021-07-30",
    },
  }, null, 2);
}
