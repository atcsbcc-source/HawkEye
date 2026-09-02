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

/** Human labels for verdicts — shared by server pages and client panels. */
export const VERDICT_LABEL: Record<VerificationVerdict, string> = {
  verified_vacant: "Verified vacant",
  false_positive: "False positive",
  occupied: "Occupied",
  needs_recheck: "Needs recheck",
};

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
  // ---- CRM / deal pipeline (20260904000000_crm.sql) ----
  crm_stage?: CrmStage;
  stage_changed_at?: string | null;
  priority?: Priority;
  /** Operator handling the deal (free text — the console has no user directory). */
  assigned_to?: string | null;
  owner_name?: string | null;
  /** The one thing to do next on this parcel, and when it is due. */
  next_action?: string | null;
  next_action_at?: string | null;
  asking_price?: number | null;
  offer_price?: number | null;
  /** After-repair value. */
  arv?: number | null;
  repair_estimate?: number | null;
  tags?: string[];
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
  /** Intelligence-model breakdown behind `vacancy_confidence` (see lib/intel). */
  factor_scores?: FactorScores | null;
  model_version?: string | null;
  flight?: Flight;
}

/** One named factor the vacancy model scored: raw value, its z-score, the
 *  model weight, and weight × z = contribution to the logit. */
export interface FactorScore {
  name: string;
  label: string;
  value: number | null;
  z: number;
  weight: number;
  contribution: number;
}

/** `property_scans.factor_scores` — the model's explanation of a scan. */
export interface FactorScores {
  model_version: string;
  probability: number;
  confidence: number;
  gated: boolean;
  factors: FactorScore[];
  top_drivers: string[];
}

/** Row shape of the `distressed_properties` view + what the grid renders. */
export interface PropertyLead extends Property {
  crm_stage: CrmStage;
  priority: Priority;
  tags: string[];
  days_distressed: number | null;
  latest_vacancy_confidence: number | null;
  latest_lawn_growth_index: number | null;
  latest_vehicle_present: boolean | null;
  latest_scan_at: string | null;
}

/** Operator-confirmed threshold: leads distressed at least this long get pushed. */
export { DISTRESS_THRESHOLD_DAYS } from "./constants";

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

/** Deal pipeline stage — ordered; `closed_*` are terminal. */
export type CrmStage =
  | "new"
  | "verified"
  | "researching"
  | "outreach"
  | "negotiating"
  | "under_contract"
  | "closed_won"
  | "closed_lost";

export const CRM_STAGES: CrmStage[] = [
  "new",
  "verified",
  "researching",
  "outreach",
  "negotiating",
  "under_contract",
  "closed_won",
  "closed_lost",
];

export const STAGE_LABEL: Record<CrmStage, string> = {
  new: "New",
  verified: "Verified",
  researching: "Researching",
  outreach: "Outreach",
  negotiating: "Negotiating",
  under_contract: "Under contract",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
};

export type Priority = "low" | "normal" | "high";
export const PRIORITIES: Priority[] = ["low", "normal", "high"];

export type ContactRole =
  "owner" | "heir" | "tenant" | "relative" | "agent" | "attorney" | "neighbor" | "other";

export const CONTACT_ROLES: ContactRole[] = [
  "owner",
  "heir",
  "tenant",
  "relative",
  "agent",
  "attorney",
  "neighbor",
  "other",
];

export const CONTACT_ROLE_LABEL: Record<ContactRole, string> = {
  owner: "Owner",
  heir: "Heir",
  tenant: "Tenant",
  relative: "Relative",
  agent: "Agent",
  attorney: "Attorney",
  neighbor: "Neighbor",
  other: "Other",
};

export type ContactChannel = "phone" | "text" | "email" | "mail";
export const CONTACT_CHANNELS: ContactChannel[] = ["phone", "text", "email", "mail"];

export interface Contact {
  id: string;
  property_id: string;
  name: string;
  role: ContactRole;
  phone: string | null;
  email: string | null;
  mailing_address: string | null;
  preferred_channel: ContactChannel | null;
  do_not_contact: boolean;
  /** Where the contact came from (county records, skip trace, neighbor…). */
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Timeline entry. `task` rows carry `due_at`; `completed_at` closes them. */
export type ActivityKind =
  "note" | "call" | "text" | "email" | "mailer" | "visit" | "offer" | "stage_change" | "task";

/** Kinds an operator can log by hand (stage changes are system-written). */
export const LOGGABLE_ACTIVITY_KINDS: ActivityKind[] = [
  "note",
  "call",
  "text",
  "email",
  "mailer",
  "visit",
  "offer",
  "task",
];

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  note: "Note",
  call: "Call",
  text: "Text",
  email: "Email",
  mailer: "Mailer",
  visit: "Site visit",
  offer: "Offer",
  stage_change: "Stage change",
  task: "Task",
};

export interface Activity {
  id: string;
  property_id: string;
  contact_id: string | null;
  kind: ActivityKind;
  body: string;
  /** Short result tag: "no answer", "left voicemail", "countered"… */
  outcome: string | null;
  /** Dollar amount for offers. */
  amount: number | null;
  due_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
}
