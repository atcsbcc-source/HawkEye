import type { LeadStatus, PropertyLead } from "../types";

/**
 * Pure serialisers for GET /api/leads/export. No I/O — unit-tested under
 * __tests__/features/leads-export.test.ts.
 */

export const LEAD_EXPORT_COLUMNS = [
  "parcel_id",
  "address",
  "lat",
  "lng",
  "neighborhood",
  "status",
  "verification",
  "days_distressed",
  "latest_vacancy_confidence",
  "latest_lawn_growth_index",
  "latest_vehicle_present",
  "latest_scan_at",
  "detail_url",
] as const;

export type LeadExportColumn = (typeof LEAD_EXPORT_COLUMNS)[number];

export interface LeadFilter {
  status?: LeadStatus | null;
  neighborhood?: string | null;
  minDays?: number | null;
}

export function filterLeads(leads: PropertyLead[], f: LeadFilter): PropertyLead[] {
  return leads.filter((l) => {
    if (f.status && l.status !== f.status) return false;
    if (f.neighborhood && (l.neighborhood ?? "").toLowerCase() !== f.neighborhood.toLowerCase()) return false;
    if (f.minDays != null && Number.isFinite(f.minDays) && (l.days_distressed ?? -1) < f.minDays) return false;
    return true;
  });
}

/** RFC 4180 field escaping: quote when the value contains a comma, quote, CR or LF. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function leadRow(lead: PropertyLead, origin: string): Record<LeadExportColumn, unknown> {
  return {
    parcel_id: lead.parcel_id,
    address: lead.address,
    lat: lead.lat,
    lng: lead.lng,
    neighborhood: lead.neighborhood ?? null,
    status: lead.status,
    verification: lead.verification ?? null,
    days_distressed: lead.days_distressed,
    latest_vacancy_confidence: lead.latest_vacancy_confidence,
    latest_lawn_growth_index: lead.latest_lawn_growth_index,
    latest_vehicle_present: lead.latest_vehicle_present,
    latest_scan_at: lead.latest_scan_at,
    detail_url: `${origin.replace(/\/$/, "")}/properties/${encodeURIComponent(lead.id)}`,
  };
}

export function leadsToCsv(leads: PropertyLead[], origin: string): string {
  const lines = [LEAD_EXPORT_COLUMNS.join(",")];
  for (const lead of leads) {
    const row = leadRow(lead, origin);
    lines.push(LEAD_EXPORT_COLUMNS.map((c) => csvEscape(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export interface LeadFeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: Record<LeadExportColumn, unknown>;
  }[];
}

export function leadsToGeoJson(leads: PropertyLead[], origin: string): LeadFeatureCollection {
  return {
    type: "FeatureCollection",
    features: leads.map((lead) => ({
      type: "Feature",
      id: lead.id,
      geometry: { type: "Point", coordinates: [lead.lng, lead.lat] },
      properties: leadRow(lead, origin),
    })),
  };
}

/** `hawkeye-leads-2026-09-02.csv` style filename. */
export function exportFileName(format: "csv" | "geojson", now = new Date()): string {
  return `hawkeye-leads-${now.toISOString().slice(0, 10)}.${format}`;
}
