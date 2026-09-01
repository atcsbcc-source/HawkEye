import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * POST /api/dispatch  { propertyId, scanId? }
 *
 * Fired after an operator manually verifies the imagery. Forwards the lead to
 * the configured CRM webhook, then marks the property `dispatched`.
 */
export async function POST(req: Request) {
  let body: { propertyId?: string; scanId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // Pull authoritative lead details server-side; never trust client payloads
  // for what we forward to the CRM.
  let lead: Record<string, unknown> = { property_id: body.propertyId };
  if (db) {
    const { data, error } = await db
      .from("properties")
      .select("id, parcel_id, address, lat, lng, status, first_flagged_at")
      .eq("id", body.propertyId)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    lead = { ...data, scan_id: body.scanId ?? null };
  }

  const webhook = process.env.CRM_WEBHOOK_URL;
  if (webhook) {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "hawkeye",
        event: "distressed_property_lead",
        dispatched_at: new Date().toISOString(),
        lead,
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `CRM webhook responded ${res.status}` },
        { status: 502 }
      );
    }
  }

  if (db) {
    await db
      .from("properties")
      .update({ status: "dispatched" })
      .eq("id", body.propertyId);
  }

  return NextResponse.json({ ok: true, forwarded: Boolean(webhook) });
}
