import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchFlight } from "@/lib/data";
import { mockDeleteFlight, mockUpdateFlight } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { FlightPatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export const GET = withAuth<Params>(async (_req, _user, { params }) => {
  const flight = await fetchFlight(params.id);
  if (!flight) return apiError("Flight not found", 404);
  return NextResponse.json({ flight });
});

/** PATCH /api/flights/[id] — metadata only; flight_code is immutable (the pipeline keys on it). */
export const PATCH = withAuth<Params>(async (req, user, { params }) => {
  const rl = rateLimit("flights:patch", user.id, 60);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, FlightPatch, { maxBytes: 8_192 });
  if (!body.ok) return body.res;
  const patch: Record<string, unknown> = { ...body.data };
  if (typeof patch.flown_at === "string") patch.flown_at = new Date(patch.flown_at).toISOString();
  if ("notes" in patch && !patch.notes) patch.notes = null;
  if (Object.keys(patch).length === 0) return apiError("No editable fields supplied", 400);

  const db = getServiceSupabase();
  let flight: unknown;
  if (db) {
    const { data, error } = await db
      .from("flights")
      .update(patch)
      .eq("id", params.id)
      .select()
      .maybeSingle();
    if (error) {
      console.error("[flights] update failed", error.code);
      return apiError("Could not update the flight", 500);
    }
    if (!data) return apiError("Flight not found", 404);
    flight = data;
  } else {
    flight = mockUpdateFlight(params.id, patch);
    if (!flight) return apiError("Flight not found", 404);
  }

  pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "flight.updated",
    subjectType: "flight",
    subjectId: params.id,
    detail: { fields: Object.keys(patch) },
  });
  return NextResponse.json({ flight });
});

/**
 * DELETE /api/flights/[id]?confirm=<flight_code> — admin only.
 * Cascades to property_scans (FK on delete cascade), so the caller must echo
 * the flight code to prove intent.
 */
export const DELETE = withAuth<Params>(
  async (req, user, { params }) => {
    const rl = rateLimit("flights:delete", user.id, 10);
    if (!rl.ok) return rateLimitResponse(rl);

    const flight = await fetchFlight(params.id);
    if (!flight) return apiError("Flight not found", 404);

    const confirm = new URL(req.url).searchParams.get("confirm");
    if (confirm !== flight.flight_code) {
      return apiError(
        `Deleting a flight removes all of its scans. Repeat the request with ?confirm=${flight.flight_code}`,
        400,
      );
    }

    const db = getServiceSupabase();
    if (db) {
      const { error } = await db.from("flights").delete().eq("id", params.id);
      if (error) {
        console.error("[flights] delete failed", error.code);
        return apiError("Could not delete the flight", 500);
      }
    } else if (!mockDeleteFlight(params.id)) {
      return apiError("Flight not found", 404);
    }

    pushEvent({
      actor: user.email,
      actorUserId: user.id,
      eventType: "flight.deleted",
      subjectType: "flight",
      subjectId: params.id,
      detail: { flight_code: flight.flight_code },
    });
    return NextResponse.json({ ok: true, deleted: flight.flight_code });
  },
  { role: "admin" },
);
