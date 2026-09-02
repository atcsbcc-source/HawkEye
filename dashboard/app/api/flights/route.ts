import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchFlights } from "@/lib/data";
import { mockCreateFlight } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { FlightCreate } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { suggestFlightCode } from "@/components/flights/flightCode";

export const dynamic = "force-dynamic";

/** GET /api/flights — every sortie with scan aggregates. */
export const GET = withAuth(async () => {
  return NextResponse.json({ flights: await fetchFlights() });
});

/** POST /api/flights { flight_code?, flown_at, neighborhood, drone_model?, altitude_m?, gsd_cm_per_px?, notes? } */
export const POST = withAuth(async (req, user) => {
  const rl = rateLimit("flights:post", user.id, 30);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, FlightCreate, { maxBytes: 8_192 });
  if (!body.ok) return body.res;
  const d = body.data;
  const flownAt = new Date(d.flown_at).toISOString();
  const row = {
    flight_code: d.flight_code ?? suggestFlightCode(flownAt, d.neighborhood),
    flown_at: flownAt,
    neighborhood: d.neighborhood,
    drone_model: d.drone_model ?? "DJI Mavic 3 Classic",
    altitude_m: d.altitude_m ?? null,
    gsd_cm_per_px: d.gsd_cm_per_px ?? null,
    notes: d.notes || null,
  };

  const db = getServiceSupabase();
  let flight: unknown;
  if (db) {
    const { data: dup, error: dupErr } = await db
      .from("flights")
      .select("id")
      .eq("flight_code", row.flight_code)
      .maybeSingle();
    if (dupErr) {
      console.error("[flights] lookup failed", dupErr.code);
      return apiError("Could not check for an existing flight", 500);
    }
    if (dup) {
      return NextResponse.json(
        { error: `Flight ${row.flight_code} already exists`, id: dup.id },
        { status: 409 },
      );
    }
    const { data, error } = await db.from("flights").insert(row).select().single();
    if (error || !data) {
      const isDup = error?.code === "23505";
      if (!isDup) console.error("[flights] insert failed", error?.code);
      return apiError(
        isDup ? `Flight ${row.flight_code} already exists` : "Could not create the flight",
        isDup ? 409 : 500,
      );
    }
    flight = data;
  } else {
    const created = mockCreateFlight(row);
    if (created === "duplicate") {
      return apiError(`Flight ${row.flight_code} already exists`, 409);
    }
    flight = created;
  }

  pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "flight.created",
    subjectType: "flight",
    subjectId: String((flight as { id: string }).id),
    detail: {
      flight_code: row.flight_code,
      neighborhood: row.neighborhood,
      flown_at: row.flown_at,
    },
  });
  return NextResponse.json({ flight }, { status: 201 });
});
