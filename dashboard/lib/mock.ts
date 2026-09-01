import type { Flight, PropertyLead, PropertyScan } from "./types";

/** Deterministic placeholder imagery so the UI is fully navigable before the
 *  first real flight is ingested. */
const img = (seed: string) => `https://picsum.photos/seed/${seed}/640/480`;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export const MOCK_LEADS: PropertyLead[] = [
  {
    id: "m1", parcel_id: "042-115-008", address: "1418 Ashwood Ct",
    lat: 35.2271, lng: -80.8431, status: "flagged",
    first_flagged_at: daysAgo(94), days_distressed: 94,
    latest_vacancy_confidence: 91, latest_lawn_growth_index: 0.62,
    latest_vehicle_present: false, latest_scan_at: daysAgo(2), notes: null,
  },
  {
    id: "m2", parcel_id: "042-118-221", address: "207 Delmar Ave",
    lat: 35.2302, lng: -80.8397, status: "flagged",
    first_flagged_at: daysAgo(71), days_distressed: 71,
    latest_vacancy_confidence: 84, latest_lawn_growth_index: 0.44,
    latest_vehicle_present: true, latest_scan_at: daysAgo(2), notes: "Static sedan in drive since W28",
  },
  {
    id: "m3", parcel_id: "042-121-030", address: "3311 Kestrel Ln",
    lat: 35.2189, lng: -80.8512, status: "flagged",
    first_flagged_at: daysAgo(38), days_distressed: 38,
    latest_vacancy_confidence: 77, latest_lawn_growth_index: 0.31,
    latest_vehicle_present: false, latest_scan_at: daysAgo(2), notes: null,
  },
  {
    id: "m4", parcel_id: "042-109-114", address: "89 Piedmont Row",
    lat: 35.2244, lng: -80.8368, status: "dispatched",
    first_flagged_at: daysAgo(120), days_distressed: 120,
    latest_vacancy_confidence: 95, latest_lawn_growth_index: 0.71,
    latest_vehicle_present: false, latest_scan_at: daysAgo(9), notes: "Sent to CRM 2026-08-23",
  },
  {
    id: "m5", parcel_id: "042-113-042", address: "1502 Ashwood Ct",
    lat: 35.2268, lng: -80.8440, status: "active",
    first_flagged_at: null, days_distressed: null,
    latest_vacancy_confidence: 22, latest_lawn_growth_index: -0.12,
    latest_vehicle_present: true, latest_scan_at: daysAgo(2), notes: null,
  },
  {
    id: "m6", parcel_id: "042-124-007", address: "612 Larkspur Dr",
    lat: 35.2210, lng: -80.8455, status: "flagged",
    first_flagged_at: daysAgo(66), days_distressed: 66,
    latest_vacancy_confidence: 80, latest_lawn_growth_index: 0.52,
    latest_vehicle_present: false, latest_scan_at: daysAgo(2), notes: null,
  },
];

const mockFlight = (weeksAgo: number): Flight => ({
  id: `f${weeksAgo}`,
  flight_code: `FLT-2026-W${35 - weeksAgo}-OAKWOOD`,
  flown_at: daysAgo(2 + weeksAgo * 7),
  neighborhood: "Oakwood",
  drone_model: "DJI Mavic 3 Classic",
});

export function mockScansFor(propertyId: string): PropertyScan[] {
  return [0, 1, 2, 3].map((w) => ({
    id: `${propertyId}-s${w}`,
    property_id: propertyId,
    flight_id: `f${w}`,
    image_url_current: img(`${propertyId}-w${35 - w}`),
    image_url_previous: img(`${propertyId}-w${34 - w}`),
    image_url_diff: null,
    lawn_growth_index: Number((0.55 - w * 0.12).toFixed(2)),
    vehicle_present: w > 1,
    vehicle_static: w > 1,
    change_score: Number((3.1 + w * 0.8).toFixed(1)),
    vacancy_confidence: Math.max(10, 91 - w * 9),
    alignment_quality: 0.87,
    processed_at: daysAgo(2 + w * 7),
    flight: mockFlight(w),
  }));
}
