import { randomUUID } from "crypto";
import { MOCK_FLIGHTS, MOCK_LEADS, mockScansFor, mockVerificationsFor } from "../mock";
import type {
  Flight,
  PropertyLead,
  PropertyScan,
  PropertyVerification,
  VerificationVerdict,
} from "../types";

/**
 * In-process store backing every write path when Supabase is not configured,
 * so add / edit / archive / verify / create-flight / sweep are all clickable
 * in dev mode. Kept on globalThis to survive dev-server hot reloads; nothing
 * here is ever used once NEXT_PUBLIC_SUPABASE_URL is set.
 */
interface MockStore {
  properties: PropertyLead[];
  verifications: PropertyVerification[];
  flights: Flight[];
  /** `${ruleId}:${propertyId}` — mirrors automation_rule_firings. */
  firings: Set<string>;
}

const g = globalThis as unknown as { __hawkeyeMockStore?: MockStore };

function store(): MockStore {
  if (!g.__hawkeyeMockStore) {
    g.__hawkeyeMockStore = {
      properties: structuredClone(MOCK_LEADS),
      verifications: MOCK_LEADS.flatMap((l) => mockVerificationsFor(l.id)),
      flights: structuredClone(MOCK_FLIGHTS),
      firings: new Set(),
    };
  }
  return g.__hawkeyeMockStore;
}

/** Test hook: drop the store so the next access re-seeds from lib/mock. */
export function resetMockStore(): void {
  delete g.__hawkeyeMockStore;
}

const daysSince = (iso: string | null): number | null =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

function withDerived(p: PropertyLead): PropertyLead {
  return { ...p, days_distressed: daysSince(p.first_flagged_at) };
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------
export function mockListProperties(): PropertyLead[] {
  return store()
    .properties.filter((p) => !p.archived_at)
    .map(withDerived);
}

/** Archived parcels are invisible (as in Supabase mode) unless `includeArchived` is set. */
export function mockGetProperty(
  id: string,
  opts: { includeArchived?: boolean } = {},
): PropertyLead | null {
  const p = store().properties.find((x) => x.id === id);
  if (!p || (p.archived_at && !opts.includeArchived)) return null;
  return withDerived(p);
}

export function mockFindByParcel(parcelId: string): PropertyLead | null {
  const p = store().properties.find((x) => x.parcel_id === parcelId);
  return p ? withDerived(p) : null;
}

export interface NewPropertyInput {
  parcel_id: string;
  address: string;
  lat: number;
  lng: number;
  neighborhood?: string | null;
  notes?: string | null;
}

export function mockCreateProperty(input: NewPropertyInput): PropertyLead {
  const created: PropertyLead = {
    id: randomUUID(),
    parcel_id: input.parcel_id,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    status: "active",
    first_flagged_at: null,
    notes: input.notes ?? null,
    neighborhood: input.neighborhood ?? null,
    archived_at: null,
    verification: null,
    verified_at: null,
    snoozed_until: null,
    days_distressed: null,
    latest_vacancy_confidence: null,
    latest_lawn_growth_index: null,
    latest_vehicle_present: null,
    latest_scan_at: null,
  };
  store().properties.push(created);
  return created;
}

/** Upsert on parcel_id; returns whether the row was new. */
export function mockUpsertProperty(input: NewPropertyInput): { id: string; created: boolean } {
  const existing = store().properties.find((p) => p.parcel_id === input.parcel_id);
  if (existing) {
    existing.address = input.address;
    existing.lat = input.lat;
    existing.lng = input.lng;
    if (input.neighborhood !== undefined) existing.neighborhood = input.neighborhood;
    // Blank cells keep the existing note (same semantics as the DB upsert).
    if (input.notes) existing.notes = input.notes;
    existing.archived_at = null;
    return { id: existing.id, created: false };
  }
  return { id: mockCreateProperty(input).id, created: true };
}

/** Un-archive a parcel and overwrite its editable fields (re-adding a tracked APN). */
export function mockRestoreProperty(id: string, input: NewPropertyInput): PropertyLead | null {
  const p = store().properties.find((x) => x.id === id);
  if (!p) return null;
  p.address = input.address;
  p.lat = input.lat;
  p.lng = input.lng;
  p.neighborhood = input.neighborhood ?? null;
  p.notes = input.notes ?? null;
  p.archived_at = null;
  return withDerived(p);
}

export function mockUpdateProperty(
  id: string,
  patch: Partial<
    Pick<
      PropertyLead,
      "address" | "lat" | "lng" | "neighborhood" | "notes" | "status" | "first_flagged_at"
    >
  >,
): PropertyLead | null {
  const p = store().properties.find((x) => x.id === id);
  if (!p) return null;
  Object.assign(p, patch);
  return withDerived(p);
}

/**
 * Mock-mode counterpart of the Postgres auto_flag_property() trigger: promote
 * to `flagged` and stamp first_flagged_at unless the parcel is dispatched,
 * archived, unknown or inside a demoting verdict's snooze window.
 */
export function mockFlagProperty(id: string): boolean {
  const p = store().properties.find((x) => x.id === id);
  if (!p || p.archived_at || p.status === "dispatched") return false;
  if (p.snoozed_until && new Date(p.snoozed_until).getTime() > Date.now()) return false;
  p.status = "flagged";
  p.first_flagged_at = p.first_flagged_at ?? new Date().toISOString();
  return true;
}

export function mockArchiveProperty(id: string): boolean {
  const p = store().properties.find((x) => x.id === id);
  if (!p) return false;
  p.archived_at = new Date().toISOString();
  return true;
}

// ---------------------------------------------------------------------------
// Verifications
// ---------------------------------------------------------------------------
export function mockListVerifications(propertyId: string): PropertyVerification[] {
  return store()
    .verifications.filter((v) => v.property_id === propertyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function mockRecordVerification(input: {
  property_id: string;
  verdict: VerificationVerdict;
  note?: string | null;
  scan_id?: string | null;
  verified_by?: string | null;
}): { verification: PropertyVerification; property: PropertyLead } | null {
  const p = store().properties.find((x) => x.id === input.property_id);
  if (!p) return null;
  const now = new Date().toISOString();
  const verification: PropertyVerification = {
    id: randomUUID(),
    property_id: p.id,
    scan_id: input.scan_id ?? null,
    verdict: input.verdict,
    note: input.note ?? null,
    verified_by: input.verified_by ?? "operator",
    created_at: now,
  };
  store().verifications.push(verification);
  p.verification = input.verdict;
  p.verified_at = now;
  if (input.verdict === "false_positive" || input.verdict === "occupied") {
    p.status = "active";
    p.first_flagged_at = null;
    p.snoozed_until = new Date(Date.now() + 8 * 7 * 86_400_000).toISOString();
  }
  return { verification, property: withDerived(p) };
}

// ---------------------------------------------------------------------------
// Scans (read-only in mock mode — only the seeded leads have imagery)
// ---------------------------------------------------------------------------
export function mockScans(propertyId: string): PropertyScan[] {
  const seeded = MOCK_LEADS.some((l) => l.id === propertyId);
  if (!seeded) return [];
  const p = store().properties.find((x) => x.id === propertyId);
  return mockScansFor(propertyId).map((s) => ({
    ...s,
    flight: store().flights.find((f) => f.id === s.flight_id) ?? s.flight,
    // keep the mock parcel's status in sync with the scans it "produced"
    property_id: p?.id ?? propertyId,
  }));
}

export function mockAllScans(): PropertyScan[] {
  return MOCK_LEADS.flatMap((l) => mockScans(l.id));
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------
export function mockListFlights(): Flight[] {
  return [...store().flights].sort((a, b) => b.flown_at.localeCompare(a.flown_at));
}

export function mockGetFlight(id: string): Flight | null {
  return store().flights.find((f) => f.id === id) ?? null;
}

export function mockCreateFlight(input: Omit<Flight, "id" | "created_at">): Flight | "duplicate" {
  if (store().flights.some((f) => f.flight_code === input.flight_code)) return "duplicate";
  const flight: Flight = { ...input, id: randomUUID(), created_at: new Date().toISOString() };
  store().flights.push(flight);
  return flight;
}

export function mockUpdateFlight(
  id: string,
  patch: Partial<Omit<Flight, "id" | "created_at">>,
): Flight | null {
  const f = store().flights.find((x) => x.id === id);
  if (!f) return null;
  Object.assign(f, patch);
  return f;
}

export function mockDeleteFlight(id: string): boolean {
  const s = store();
  const before = s.flights.length;
  s.flights = s.flights.filter((f) => f.id !== id);
  return s.flights.length !== before;
}

// ---------------------------------------------------------------------------
// Rule firings (sweep idempotency)
// ---------------------------------------------------------------------------
export function mockHasFiring(ruleId: string, subjectId: string): boolean {
  return store().firings.has(`${ruleId}:${subjectId}`);
}

export function mockRecordFiring(ruleId: string, subjectId: string): void {
  store().firings.add(`${ruleId}:${subjectId}`);
}
