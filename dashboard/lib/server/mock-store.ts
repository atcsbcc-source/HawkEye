import { randomUUID } from "crypto";
import type { FlagOutcome, StageOutcome, TaskOutcome } from "../automation/actions";
import {
  MOCK_FLIGHTS,
  MOCK_LEADS,
  mockActivitiesFor,
  mockContactsFor,
  mockScansFor,
  mockVerificationsFor,
} from "../mock";
import type {
  Activity,
  Contact,
  CrmStage,
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
  contacts: Contact[];
  activities: Activity[];
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
      contacts: MOCK_LEADS.flatMap((l) => mockContactsFor(l.id)),
      activities: MOCK_LEADS.flatMap((l) => mockActivitiesFor(l.id)),
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
    crm_stage: "new",
    stage_changed_at: null,
    priority: "normal",
    assigned_to: null,
    owner_name: null,
    next_action: null,
    next_action_at: null,
    asking_price: null,
    offer_price: null,
    arv: null,
    repair_estimate: null,
    tags: [],
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

/** Archived parcels are not editable (Supabase mode filters `archived_at is null`). */
export function mockUpdateProperty(
  id: string,
  patch: Partial<
    Pick<
      PropertyLead,
      | "address"
      | "lat"
      | "lng"
      | "neighborhood"
      | "notes"
      | "status"
      | "first_flagged_at"
      | "priority"
      | "assigned_to"
      | "owner_name"
      | "next_action"
      | "next_action_at"
      | "asking_price"
      | "offer_price"
      | "arv"
      | "repair_estimate"
      | "tags"
    >
  >,
): PropertyLead | null {
  const p = store().properties.find((x) => x.id === id);
  if (!p || p.archived_at) return null;
  Object.assign(p, patch);
  return withDerived(p);
}

/**
 * Mock-mode counterpart of the Postgres auto_flag_property() trigger: promote
 * to `flagged` and stamp first_flagged_at unless the parcel is dispatched,
 * archived, unknown or inside a demoting verdict's snooze window. Reports
 * `already_flagged` so callers can tell a no-op from a real transition.
 */
export function mockFlagProperty(id: string): FlagOutcome {
  const p = store().properties.find((x) => x.id === id);
  if (!p || p.archived_at || p.status === "dispatched") return "not_flaggable";
  if (p.snoozed_until && new Date(p.snoozed_until).getTime() > Date.now()) return "not_flaggable";
  if (p.status === "flagged") return "already_flagged";
  p.status = "flagged";
  p.first_flagged_at = p.first_flagged_at ?? new Date().toISOString();
  return "flagged";
}

/** False for unknown AND already-archived parcels (a repeat DELETE is a 404, as in Supabase mode). */
export function mockArchiveProperty(id: string): boolean {
  const p = store().properties.find((x) => x.id === id);
  if (!p || p.archived_at) return false;
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
  if (!p || p.archived_at) return null;
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
// CRM — stage, contacts, activities / tasks
// ---------------------------------------------------------------------------
/** Move a parcel through the pipeline; writes the stage_change activity. */
export function mockSetStage(
  id: string,
  stage: CrmStage,
  by = "operator",
  note?: string | null,
): { outcome: StageOutcome; property: PropertyLead | null; previous: CrmStage | null } {
  const p = store().properties.find((x) => x.id === id);
  if (!p || p.archived_at) return { outcome: "not_found", property: null, previous: null };
  const previous = p.crm_stage;
  if (previous === stage) return { outcome: "unchanged", property: withDerived(p), previous };
  p.crm_stage = stage;
  p.stage_changed_at = new Date().toISOString();
  store().activities.push({
    id: randomUUID(),
    property_id: p.id,
    contact_id: null,
    kind: "stage_change",
    body: note ? `${previous} → ${stage} — ${note}` : `${previous} → ${stage}`,
    outcome: null,
    amount: null,
    due_at: null,
    completed_at: null,
    created_by: by,
    created_at: p.stage_changed_at,
  });
  return { outcome: "changed", property: withDerived(p), previous };
}

export function mockListContacts(propertyId: string): Contact[] {
  return store()
    .contacts.filter((c) => c.property_id === propertyId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export type ContactInput = Omit<Contact, "id" | "property_id" | "created_at" | "updated_at">;

export function mockCreateContact(propertyId: string, input: ContactInput): Contact | null {
  const p = store().properties.find((x) => x.id === propertyId);
  if (!p || p.archived_at) return null;
  const now = new Date().toISOString();
  const contact: Contact = {
    ...input,
    id: randomUUID(),
    property_id: propertyId,
    created_at: now,
    updated_at: now,
  };
  store().contacts.push(contact);
  return contact;
}

export function mockUpdateContact(
  propertyId: string,
  id: string,
  patch: Partial<ContactInput>,
): Contact | null {
  const c = store().contacts.find((x) => x.id === id && x.property_id === propertyId);
  if (!c) return null;
  Object.assign(c, patch, { updated_at: new Date().toISOString() });
  return c;
}

export function mockDeleteContact(propertyId: string, id: string): boolean {
  const s = store();
  const before = s.contacts.length;
  s.contacts = s.contacts.filter((c) => !(c.id === id && c.property_id === propertyId));
  if (s.contacts.length === before) return false;
  for (const a of s.activities) if (a.contact_id === id) a.contact_id = null;
  return true;
}

/** Newest first. */
export function mockListActivities(propertyId: string): Activity[] {
  return store()
    .activities.filter((a) => a.property_id === propertyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export type ActivityInput = Pick<Activity, "kind" | "body"> &
  Partial<Pick<Activity, "contact_id" | "outcome" | "amount" | "due_at" | "created_by">>;

export function mockCreateActivity(propertyId: string, input: ActivityInput): Activity | null {
  const p = store().properties.find((x) => x.id === propertyId);
  if (!p || p.archived_at) return null;
  if (
    input.contact_id &&
    !store().contacts.some((c) => c.id === input.contact_id && c.property_id === propertyId)
  ) {
    return null;
  }
  const activity: Activity = {
    id: randomUUID(),
    property_id: propertyId,
    contact_id: input.contact_id ?? null,
    kind: input.kind,
    body: input.body,
    outcome: input.outcome ?? null,
    amount: input.amount ?? null,
    due_at: input.due_at ?? null,
    completed_at: null,
    created_by: input.created_by ?? "operator",
    created_at: new Date().toISOString(),
  };
  store().activities.push(activity);
  return activity;
}

export function mockUpdateActivity(
  propertyId: string,
  id: string,
  patch: Partial<Pick<Activity, "body" | "outcome" | "due_at" | "completed_at">>,
): Activity | null {
  const a = store().activities.find((x) => x.id === id && x.property_id === propertyId);
  if (!a) return null;
  Object.assign(a, patch);
  return a;
}

/** Every open task across non-archived parcels, soonest due first. */
export function mockListOpenTasks(): Activity[] {
  const live = new Set(mockListProperties().map((p) => p.id));
  return store()
    .activities.filter((a) => a.kind === "task" && !a.completed_at && live.has(a.property_id))
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
}

/** Rule-action adapters (see lib/automation/actions.ts ActionDeps). */
export function mockSetStageForRule(propertyId: string, stage: string, by: string): StageOutcome {
  return mockSetStage(propertyId, stage as CrmStage, by).outcome;
}

export function mockCreateTaskForRule(
  propertyId: string,
  title: string,
  dueAt: string,
  by: string,
): TaskOutcome {
  // Same idempotency as the DB path: one open task per (rule, parcel).
  const dup = store().activities.some(
    (a) =>
      a.property_id === propertyId && a.kind === "task" && a.created_by === by && !a.completed_at,
  );
  if (dup) return "exists";
  const created = mockCreateActivity(propertyId, {
    kind: "task",
    body: title,
    due_at: dueAt,
    created_by: by,
  });
  return created ? "created" : "not_found";
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
