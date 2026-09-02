import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchFlight } from "@/lib/data";
import { mockDeleteFlight, mockUpdateFlight } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";

export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    flown_at: z
      .string()
      .trim()
      .refine((s) => !Number.isNaN(new Date(s).getTime()), "flown_at must be a date")
      .optional(),
    neighborhood: z.string().trim().min(1).max(80).optional(),
    drone_model: z.string().trim().min(1).max(80).optional(),
    altitude_m: z.coerce.number().min(5).max(500).nullable().optional(),
    gsd_cm_per_px: z.coerce.number().min(0.1).max(100).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  const flight = await fetchFlight(params.id);
  if (!flight) return NextResponse.json({ error: "Flight not found" }, { status: 404 });
  return NextResponse.json({ flight });
}

/** PATCH /api/flights/[id] — metadata only; flight_code is immutable (the pipeline keys on it). */
export async function PATCH(req: Request, { params }: Params) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }
  const patch: Record<string, unknown> = { ...parsed.data };
  if (typeof patch.flown_at === "string") patch.flown_at = new Date(patch.flown_at).toISOString();
  if ("notes" in patch && !patch.notes) patch.notes = null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  const db = getServiceSupabase();
  let flight: unknown;
  if (db) {
    const { data, error } = await db.from("flights").update(patch).eq("id", params.id).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Flight not found" }, { status: 404 });
    flight = data;
  } else {
    flight = mockUpdateFlight(params.id, patch);
    if (!flight) return NextResponse.json({ error: "Flight not found" }, { status: 404 });
  }

  pushEvent({
    actor: "operator",
    eventType: "flight.updated",
    subjectType: "flight",
    subjectId: params.id,
    detail: { fields: Object.keys(patch) },
  });
  return NextResponse.json({ flight });
}

/**
 * DELETE /api/flights/[id]?confirm=<flight_code>
 * Cascades to property_scans (FK on delete cascade), so the caller must echo
 * the flight code to prove intent.
 */
export async function DELETE(req: Request, { params }: Params) {
  const flight = await fetchFlight(params.id);
  if (!flight) return NextResponse.json({ error: "Flight not found" }, { status: 404 });

  const confirm = new URL(req.url).searchParams.get("confirm");
  if (confirm !== flight.flight_code) {
    return NextResponse.json(
      { error: `Deleting a flight removes all of its scans. Repeat the request with ?confirm=${flight.flight_code}` },
      { status: 400 }
    );
  }

  const db = getServiceSupabase();
  if (db) {
    const { error } = await db.from("flights").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (!mockDeleteFlight(params.id)) {
    return NextResponse.json({ error: "Flight not found" }, { status: 404 });
  }

  pushEvent({
    actor: "operator",
    eventType: "flight.deleted",
    subjectType: "flight",
    subjectId: params.id,
    detail: { flight_code: flight.flight_code },
  });
  return NextResponse.json({ ok: true, deleted: flight.flight_code });
}
