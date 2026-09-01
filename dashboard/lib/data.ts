import { getSupabase } from "./supabase";
import { MOCK_LEADS, mockScansFor } from "./mock";
import type { PropertyLead, PropertyScan } from "./types";

/** All properties joined with their latest scan signals. Falls back to mock
 *  data when Supabase isn't configured (see .env.example). */
export async function fetchLeads(): Promise<PropertyLead[]> {
  const db = getSupabase();
  if (!db) return MOCK_LEADS;

  // Distressed view covers flagged/dispatched; union in the still-active rows.
  const [{ data: distressed }, { data: active }] = await Promise.all([
    db.from("distressed_properties").select("*"),
    db.from("properties").select("*").is("first_flagged_at", null),
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
  const leads = await fetchLeads();
  return leads.find((l) => l.id === id) ?? null;
}

/** Scan history for one property, newest first, with flight metadata. */
export async function fetchScans(propertyId: string): Promise<PropertyScan[]> {
  const db = getSupabase();
  if (!db) return mockScansFor(propertyId);

  const { data } = await db
    .from("property_scans")
    .select("*, flight:flights(*)")
    .eq("property_id", propertyId)
    .order("processed_at", { ascending: false });

  const scans = (data ?? []) as PropertyScan[];
  // Bucket paths → signed URLs so the private imagery renders.
  return Promise.all(
    scans.map(async (s) => ({
      ...s,
      image_url_current: await signUrl(s.image_url_current),
      image_url_previous: s.image_url_previous ? await signUrl(s.image_url_previous) : null,
    }))
  );
}

async function signUrl(path: string): Promise<string> {
  if (path.startsWith("http")) return path;
  const db = getSupabase();
  if (!db) return path;
  const { data } = await db.storage.from("property-scans").createSignedUrl(path, 3600);
  return data?.signedUrl ?? path;
}
