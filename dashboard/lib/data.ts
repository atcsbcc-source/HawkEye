import { getSupabase } from "./supabase";
import {
  mockAllScans,
  mockGetFlight,
  mockGetProperty,
  mockListFlights,
  mockListProperties,
  mockListVerifications,
  mockScans,
} from "./server/mock-store";
import type {
  Flight,
  FlightSummary,
  PropertyLead,
  PropertyScan,
  PropertyVerification,
} from "./types";

import { AUTO_FLAG_CONFIDENCE } from "./constants";

/** All properties joined with their latest scan signals. Falls back to the
 *  in-process mock store when Supabase isn't configured (see .env.example). */
export async function fetchLeads(): Promise<PropertyLead[]> {
  const db = getSupabase();
  if (!db) return mockListProperties();

  // Distressed view covers flagged/dispatched; union in the still-active rows.
  const [{ data: distressed }, { data: active }] = await Promise.all([
    db.from("distressed_properties").select("*"),
    db.from("properties").select("*").is("first_flagged_at", null).is("archived_at", null),
  ]);

  const activeLeads: PropertyLead[] = (active ?? []).map((p) => ({
    ...p,
    days_distressed: null,
    latest_vacancy_confidence: null,
    latest_lawn_growth_index: null,
    latest_vehicle_present: null,
    latest_scan_at: null,
  }));
  return [...((distressed ?? []) as PropertyLead[]), ...activeLeads];
}

export async function fetchLead(id: string): Promise<PropertyLead | null> {
  const db = getSupabase();
  if (!db) return mockGetProperty(id);
  const leads = await fetchLeads();
  return leads.find((l) => l.id === id) ?? null;
}

/** Scan history for one property, newest flight first, with flight metadata. */
export async function fetchScans(propertyId: string): Promise<PropertyScan[]> {
  const db = getSupabase();
  if (!db) return mockScans(propertyId);

  const { data } = await db
    .from("property_scans")
    .select("*, flight:flights(*)")
    .eq("property_id", propertyId);

  const scans = sortByFlownAtDesc((data ?? []) as PropertyScan[]);
  // Bucket paths → signed URLs so the private imagery renders.
  return Promise.all(
    scans.map(async (s) => ({
      ...s,
      image_url_current: await signUrl(s.image_url_current),
      image_url_previous: s.image_url_previous ? await signUrl(s.image_url_previous) : null,
      image_url_diff: s.image_url_diff ? await signUrl(s.image_url_diff) : null,
      raw_metrics: s.raw_metrics ?? null,
    }))
  );
}

/** Order by the sortie date rather than processed_at so a reprocess never
 *  shuffles the week buttons. */
export function sortByFlownAtDesc(scans: PropertyScan[]): PropertyScan[] {
  return [...scans].sort((a, b) => {
    const fa = a.flight?.flown_at ?? a.processed_at;
    const fb = b.flight?.flown_at ?? b.processed_at;
    return fb.localeCompare(fa);
  });
}

// ---------------------------------------------------------------------------
// Verifications
// ---------------------------------------------------------------------------
export async function fetchVerifications(propertyId: string): Promise<PropertyVerification[]> {
  const db = getSupabase();
  if (!db) return mockListVerifications(propertyId);
  const { data } = await db
    .from("property_verifications")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });
  return (data ?? []) as PropertyVerification[];
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------
type ScanLite = Pick<PropertyScan, "property_id" | "flight_id" | "vacancy_confidence" | "alignment_quality"> & {
  flown_at: string;
};

/**
 * Pure aggregation shared by mock and DB modes: per flight, how many parcels
 * it scanned, how many crossed the auto-flag line for the first time (previous
 * scan of that parcel absent or below threshold), and mean alignment quality.
 */
export function summarizeFlights(flights: Flight[], scans: ScanLite[]): FlightSummary[] {
  const byProperty = new Map<string, ScanLite[]>();
  for (const s of scans) {
    const list = byProperty.get(s.property_id) ?? [];
    list.push(s);
    byProperty.set(s.property_id, list);
  }
  const newlyFlaggedByFlight = new Map<string, number>();
  for (const list of Array.from(byProperty.values())) {
    list.sort((a: ScanLite, b: ScanLite) => a.flown_at.localeCompare(b.flown_at));
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      const prev = i > 0 ? list[i - 1] : null;
      const crossed =
        cur.vacancy_confidence >= AUTO_FLAG_CONFIDENCE &&
        (!prev || prev.vacancy_confidence < AUTO_FLAG_CONFIDENCE);
      if (crossed) {
        newlyFlaggedByFlight.set(cur.flight_id, (newlyFlaggedByFlight.get(cur.flight_id) ?? 0) + 1);
      }
    }
  }
  return flights.map((f) => {
    const own = scans.filter((s) => s.flight_id === f.id);
    const aligned = own.filter((s) => s.alignment_quality != null);
    const mean =
      aligned.length > 0
        ? aligned.reduce((acc, s) => acc + Number(s.alignment_quality), 0) / aligned.length
        : null;
    return {
      ...f,
      scan_count: own.length,
      newly_flagged: newlyFlaggedByFlight.get(f.id) ?? 0,
      mean_alignment: mean == null ? null : Number(mean.toFixed(3)),
    };
  });
}

export async function fetchFlights(): Promise<FlightSummary[]> {
  const db = getSupabase();
  if (!db) {
    const flights = mockListFlights();
    const scans = mockAllScans().map((s) => ({
      property_id: s.property_id,
      flight_id: s.flight_id,
      vacancy_confidence: s.vacancy_confidence,
      alignment_quality: s.alignment_quality,
      flown_at: s.flight?.flown_at ?? s.processed_at,
    }));
    return summarizeFlights(flights, scans);
  }

  const [{ data: flights }, { data: scans }] = await Promise.all([
    db.from("flights").select("*").order("flown_at", { ascending: false }),
    db
      .from("property_scans")
      .select("property_id, flight_id, vacancy_confidence, alignment_quality, flight:flights(flown_at)"),
  ]);
  const lite: ScanLite[] = ((scans ?? []) as any[]).map((s) => ({
    property_id: s.property_id,
    flight_id: s.flight_id,
    vacancy_confidence: s.vacancy_confidence,
    alignment_quality: s.alignment_quality,
    flown_at: s.flight?.flown_at ?? "",
  }));
  return summarizeFlights((flights ?? []) as Flight[], lite);
}

export async function fetchFlight(id: string): Promise<Flight | null> {
  const db = getSupabase();
  if (!db) return mockGetFlight(id);
  const { data } = await db.from("flights").select("*").eq("id", id).maybeSingle();
  return (data as Flight | null) ?? null;
}

/** Scans produced by one flight, highest confidence first, with the parcel
 *  attached as `property` for linking. */
export async function fetchFlightScans(
  flightId: string
): Promise<(PropertyScan & { property?: Pick<PropertyLead, "id" | "address" | "parcel_id" | "status"> })[]> {
  const db = getSupabase();
  if (!db) {
    return mockAllScans()
      .filter((s) => s.flight_id === flightId)
      .map((s) => {
        const p = mockGetProperty(s.property_id);
        return {
          ...s,
          property: p
            ? { id: p.id, address: p.address, parcel_id: p.parcel_id, status: p.status }
            : undefined,
        };
      })
      .sort((a, b) => b.vacancy_confidence - a.vacancy_confidence);
  }
  const { data } = await db
    .from("property_scans")
    .select("*, property:properties(id, address, parcel_id, status)")
    .eq("flight_id", flightId)
    .order("vacancy_confidence", { ascending: false });
  return (data ?? []) as any[];
}

/** Distinct neighborhoods across tracked parcels and flights (for filters and the flight form). */
export async function fetchNeighborhoods(): Promise<string[]> {
  const [leads, flights] = await Promise.all([fetchLeads(), fetchFlights()]);
  const set = new Set<string>();
  for (const l of leads) if (l.neighborhood) set.add(l.neighborhood);
  for (const f of flights) if (f.neighborhood) set.add(f.neighborhood);
  return Array.from(set).sort();
}

async function signUrl(path: string): Promise<string> {
  if (path.startsWith("http")) return path;
  const db = getSupabase();
  if (!db) return path;
  const { data } = await db.storage.from("property-scans").createSignedUrl(path, 3600);
  return data?.signedUrl ?? path;
}
