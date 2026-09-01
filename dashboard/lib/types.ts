export type LeadStatus = "active" | "flagged" | "dispatched";

export interface Property {
  id: string;
  parcel_id: string;
  address: string;
  lat: number;
  lng: number;
  status: LeadStatus;
  first_flagged_at: string | null;
  notes: string | null;
}

export interface Flight {
  id: string;
  flight_code: string;
  flown_at: string;
  neighborhood: string;
  drone_model: string;
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
export const DISTRESS_THRESHOLD_DAYS = 60;
