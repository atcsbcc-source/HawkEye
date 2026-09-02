import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchLeads } from "@/lib/data";
import { mockCreateProperty, mockFindByParcel, mockRestoreProperty } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { PropertyCreate } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/properties — every tracked (non-archived) parcel with latest signals. */
export const GET = withAuth(async () => {
  return NextResponse.json({ properties: await fetchLeads() });
});

/**
 * POST /api/properties { parcel_id, address, lat, lng, neighborhood?, notes? }
 * 201 on create. Re-adding an archived APN restores it in place (200,
 * `restored: true`); an active duplicate is a 409.
 */
export const POST = withAuth(async (req, user) => {
  const rl = rateLimit("properties:post", user.id, 60);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, PropertyCreate, { maxBytes: 8_192 });
  if (!body.ok) return body.res;
  const input = {
    ...body.data,
    neighborhood: body.data.neighborhood || null,
    notes: body.data.notes || null,
  };

  const db = getServiceSupabase();
  let property: Record<string, unknown>;
  let restored = false;
  if (db) {
    const { data: existing, error: lookupErr } = await db
      .from("properties")
      .select("id, archived_at")
      .eq("parcel_id", input.parcel_id)
      .maybeSingle();
    if (lookupErr) {
      console.error("[properties] lookup failed", lookupErr.code);
      return apiError("Could not check for an existing parcel", 500);
    }
    if (existing && !existing.archived_at) {
      return NextResponse.json(
        { error: `A property with parcel_id ${input.parcel_id} already exists`, id: existing.id },
        { status: 409 },
      );
    }
    if (existing) {
      const { data, error } = await db
        .from("properties")
        .update({ ...input, archived_at: null })
        .eq("id", existing.id)
        .select()
        .single();
      if (error || !data) {
        console.error("[properties] restore failed", error?.code);
        return apiError("Could not restore the archived property", 500);
      }
      property = data;
      restored = true;
    } else {
      const { data, error } = await db.from("properties").insert(input).select().single();
      if (error || !data) {
        const dup = error?.code === "23505";
        if (!dup) console.error("[properties] insert failed", error?.code);
        return apiError(
          dup ? "Duplicate parcel_id" : "Could not create the property",
          dup ? 409 : 500,
        );
      }
      property = data;
    }
  } else {
    const existing = mockFindByParcel(input.parcel_id);
    if (existing && !existing.archived_at) {
      return NextResponse.json(
        { error: `A property with parcel_id ${input.parcel_id} already exists`, id: existing.id },
        { status: 409 },
      );
    }
    if (existing) {
      property = mockRestoreProperty(existing.id, input) as unknown as Record<string, unknown>;
      restored = true;
    } else {
      property = mockCreateProperty(input) as unknown as Record<string, unknown>;
    }
  }

  await pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: restored ? "property.restored" : "property.created",
    subjectType: "property",
    subjectId: String(property.id),
    detail: {
      parcel_id: input.parcel_id,
      address: input.address,
      neighborhood: input.neighborhood,
    },
  });
  return NextResponse.json({ property, restored }, { status: restored ? 200 : 201 });
});
