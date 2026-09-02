export type LeadStatus = "active" | "flagged" | "dispatched";

/** Operator verdict recorded against a flagged parcel. */
export type VerificationVerdict =
  "verified_vacant" | "false_positive" | "occupied" | "needs_recheck";

export const VERIFICATION_VERDICTS: VerificationVerdict[] = [
  "verified_vacant",
  "false_positive",
  "occupied",
  "needs_recheck",
];

export interface Property {
  id: string;
  parcel_id: string;
  address: string;
  lat: number;
  lng: number;
  status: LeadStatus;
  first_flagged_at: string | null;
  notes: string | null;
  /** Grid / flight neighborhood the parcel belongs to (nullable until backfilled). */
  neighborhood?: string | null;
  /** Soft delete — archived parcels drop out of the dashboard but keep their scans. */
  archived_at?: string | null;
  verification?: VerificationVerdict | null;
  verified_at?: string | null;
  /** While set and in the future, the auto-flag trigger leaves a false positive alone. */
  snoozed_until?: string | null;
}

export interface PropertyVerification {
  id: string;
  property_id: string;
  scan_id: string | null;
  verdict: VerificationVerdict;
  note: string | null;
  verified_by: string | null;
  created_at: string;
}

export interface Flight {
  id: string;
  flight_code: string;
  flown_at: string;
  neighborhood: string;
  drone_model: string;
  altitude_m?: number | null;
  gsd_cm_per_px?: number | null;
  notes?: string | null;
  created_at?: string;
}

/** Flight row plus the aggregates the /flights table renders. */
export interface FlightSummary extends Flight {
  scan_count: number;
  newly_flagged: number;
  mean_alignment: number | null;
}

export interface PropertyScan {
  id: string;
  property_id: string;
  flight_id: string;
  image_url_current: string;
  image_url_previous: string | null;
  image_url_diff: string | null;
  lawn_growth_index: number | null;
  vehicle_present: boolean | null;
  vehicle_static: boolean | null;
  change_score: number | null;
  vacancy_confidence: number;
  alignment_quality: number | null;
  processed_at: string;
  /** Full pipeline JSON (`details.low_alignment`, vehicle boxes, ...). */
  raw_metrics?: Record<string, unknown> | null;
  flight?: Flight;
}

/** Row shape of the `distressed_properties` view + what the grid renders. */
export interface PropertyLead extends Property {
  days_distressed: number | null;
  latest_vacancy_confidence: number | null;
  latest_lawn_growth_index: number | null;
  latest_vehicle_present: boolean | null;
  latest_scan_at: string | null;
}

/** Operator-confirmed threshold: leads distressed at least this long get pushed. */
export { DISTRESS_THRESHOLD_DAYS } from "./constants";
