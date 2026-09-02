import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchLead } from "@/lib/data";
import { mockArchiveProperty, mockUpdateProperty } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { PropertyPatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export const GET = withAuth<Params>(async (_req, _user, { params }) => {
  const lead = await fetchLead(params.id);
  if (!lead) return apiError("Property not found", 404);
  return NextResponse.json({ property: lead });
});

/** PATCH /api/properties/[id] { address?, lat?, lng?, neighborhood?, notes? } */
export const PATCH = withAuth<Params>(async (req, user, { params }) => {
  const rl = rateLimit("properties:patch", user.id, 120);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, PropertyPatch, { maxBytes: 8_192 });
  if (!body.ok) return body.res;
  const patch: Record<string, unknown> = { ...body.data };
  for (const k of ["neighborhood", "notes", "assigned_to", "owner_name", "next_action"]) {
    if (k in patch && !patch[k]) patch[k] = null;
  }
  if ("next_action_at" in patch) {
    patch.next_action_at = patch.next_action_at
      ? new Date(String(patch.next_action_at)).toISOString()
      : null;
  }
  if (Array.isArray(patch.tags)) {
    patch.tags = Array.from(new Set((patch.tags as string[]).map((t) => t.toLowerCase())));
  }
  if (Object.keys(patch).length === 0) return apiError("No editable fields supplied", 400);

  const db = getServiceSupabase();
  let property: unknown;
  if (db) {
    const { data, error } = await db
      .from("properties")
      .update(patch)
      .eq("id", params.id)
      .is("archived_at", null)
      .select()
      .maybeSingle();
    if (error) {
      console.error("[properties] update failed", error.code);
      return apiError("Could not update the property", 500);
    }
    if (!data) return apiError("Property not found", 404);
    property = data;
  } else {
    property = mockUpdateProperty(params.id, patch);
    if (!property) return apiError("Property not found", 404);
  }

  await pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "property.updated",
    subjectType: "property",
    subjectId: params.id,
    detail: { fields: Object.keys(patch) },
  });
  return NextResponse.json({ property });
});

/** DELETE /api/properties/[id] — soft delete (archived_at); scans and audit rows survive. */
export const DELETE = withAuth<Params>(async (_req, user, { params }) => {
  const rl = rateLimit("properties:delete", user.id, 30);
  if (!rl.ok) return rateLimitResponse(rl);

  const db = getServiceSupabase();
  if (db) {
    const { data, error } = await db
      .from("properties")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", params.id)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[properties] archive failed", error.code);
      return apiError("Could not archive the property", 500);
    }
    if (!data) return apiError("Property not found", 404);
  } else if (!mockArchiveProperty(params.id)) {
    return apiError("Property not found", 404);
  }

  await pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "property.archived",
    subjectType: "property",
    subjectId: params.id,
    detail: {},
  });
  return NextResponse.json({ ok: true, archived: true });
});
