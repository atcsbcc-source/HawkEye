import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchLead } from "@/lib/data";
import { mockArchiveProperty, mockUpdateProperty } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";

export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    address: z.string().trim().min(1).max(200).optional(),
    lat: z.coerce.number().refine(Number.isFinite, "lat must be a number").min(-90).max(90).optional(),
    lng: z.coerce.number().refine(Number.isFinite, "lng must be a number").min(-180).max(180).optional(),
    neighborhood: z.string().trim().max(80).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  const lead = await fetchLead(params.id);
  if (!lead) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  return NextResponse.json({ property: lead });
}

/** PATCH /api/properties/[id] { address?, lat?, lng?, neighborhood?, notes? } */
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
  if ("neighborhood" in patch && !patch.neighborhood) patch.neighborhood = null;
  if ("notes" in patch && !patch.notes) patch.notes = null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  const db = getServiceSupabase();
  let property: unknown;
  if (db) {
    const { data, error } = await db
      .from("properties")
      .update(patch)
      .eq("id", params.id)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    property = data;
  } else {
    property = mockUpdateProperty(params.id, patch);
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  pushEvent({
    actor: "operator",
    eventType: "property.updated",
    subjectType: "property",
    subjectId: params.id,
    detail: { fields: Object.keys(patch) },
  });
  return NextResponse.json({ property });
}

/** DELETE /api/properties/[id] — soft delete (archived_at); scans and audit rows survive. */
export async function DELETE(_req: Request, { params }: Params) {
  const db = getServiceSupabase();
  if (db) {
    const { data, error } = await db
      .from("properties")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Property not found" }, { status: 404 });
  } else if (!mockArchiveProperty(params.id)) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  pushEvent({
    actor: "operator",
    eventType: "property.archived",
    subjectType: "property",
    subjectId: params.id,
    detail: {},
  });
  return NextResponse.json({ ok: true, archived: true });
}
