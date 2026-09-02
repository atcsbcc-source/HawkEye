import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchLeads } from "@/lib/data";
import { mockCreateProperty, mockFindByParcel } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";

export const dynamic = "force-dynamic";

const CreatePropertySchema = z.object({
  parcel_id: z.string().trim().min(1).max(64),
  address: z.string().trim().min(1).max(200),
  lat: z.coerce.number().refine(Number.isFinite, "lat must be a number").min(-90).max(90),
  lng: z.coerce.number().refine(Number.isFinite, "lng must be a number").min(-180).max(180),
  neighborhood: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

/** GET /api/properties — every tracked (non-archived) parcel with latest signals. */
export async function GET() {
  return NextResponse.json({ properties: await fetchLeads() });
}

/** POST /api/properties { parcel_id, address, lat, lng, neighborhood?, notes? } */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreatePropertySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: formatIssues(parsed.error) }, { status: 400 });
  }
  const input = {
    ...parsed.data,
    neighborhood: parsed.data.neighborhood || null,
    notes: parsed.data.notes || null,
  };

  const db = getServiceSupabase();
  let property: Record<string, unknown>;
  if (db) {
    const { data: existing } = await db
      .from("properties")
      .select("id")
      .eq("parcel_id", input.parcel_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `A property with parcel_id ${input.parcel_id} already exists`, id: existing.id },
        { status: 409 },
      );
    }
    const { data, error } = await db.from("properties").insert(input).select().single();
    if (error || !data) {
      const dup = error?.code === "23505";
      return NextResponse.json(
        { error: dup ? "Duplicate parcel_id" : (error?.message ?? "Insert failed") },
        { status: dup ? 409 : 500 },
      );
    }
    property = data;
  } else {
    if (mockFindByParcel(input.parcel_id)) {
      return NextResponse.json(
        { error: `A property with parcel_id ${input.parcel_id} already exists` },
        { status: 409 },
      );
    }
    property = mockCreateProperty(input) as unknown as Record<string, unknown>;
  }

  pushEvent({
    actor: "operator",
    eventType: "property.created",
    subjectType: "property",
    subjectId: String(property.id),
    detail: {
      parcel_id: input.parcel_id,
      address: input.address,
      neighborhood: input.neighborhood,
    },
  });
  return NextResponse.json({ property }, { status: 201 });
}
