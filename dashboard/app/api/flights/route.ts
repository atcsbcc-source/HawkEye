import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchFlights } from "@/lib/data";
import { mockCreateFlight } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { suggestFlightCode } from "@/components/flights/flightCode";

export const dynamic = "force-dynamic";

const CreateFlightSchema = z.object({
  flight_code: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "letters, digits, . _ - only")
    .optional(),
  flown_at: z
    .string()
    .trim()
    .min(1)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "flown_at must be a date"),
  neighborhood: z.string().trim().min(1).max(80),
  drone_model: z.string().trim().min(1).max(80).optional(),
  altitude_m: z.coerce.number().min(5).max(500).nullish(),
  gsd_cm_per_px: z.coerce.number().min(0.1).max(100).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

/** GET /api/flights — every sortie with scan aggregates. */
export async function GET() {
  return NextResponse.json({ flights: await fetchFlights() });
}

/** POST /api/flights { flight_code?, flown_at, neighborhood, drone_model?, altitude_m?, gsd_cm_per_px?, notes? } */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateFlightSchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }
  const d = parsed.data;
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
    const { data: dup } = await db
      .from("flights")
      .select("id")
      .eq("flight_code", row.flight_code)
      .maybeSingle();
    if (dup) {
      return NextResponse.json(
        { error: `Flight ${row.flight_code} already exists`, id: dup.id },
        { status: 409 },
      );
    }
    const { data, error } = await db.from("flights").insert(row).select().single();
    if (error || !data) {
      const isDup = error?.code === "23505";
      return NextResponse.json(
        {
          error: isDup
            ? `Flight ${row.flight_code} already exists`
            : (error?.message ?? "Insert failed"),
        },
        { status: isDup ? 409 : 500 },
      );
    }
    flight = data;
  } else {
    const created = mockCreateFlight(row);
    if (created === "duplicate") {
      return NextResponse.json(
        { error: `Flight ${row.flight_code} already exists` },
        { status: 409 },
      );
    }
    flight = created;
  }

  pushEvent({
    actor: "operator",
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
}
