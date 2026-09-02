import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchActivities } from "@/lib/crm-data";
import { mockCreateActivity } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { ActivityCreate } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import type { Activity } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/** GET /api/properties/[id]/activities — newest first. */
export const GET = withAuth<Params>(async (_req, _user, { params }) => {
  return NextResponse.json({ activities: await fetchActivities(params.id) });
});

/**
 * POST /api/properties/[id]/activities { kind, body, outcome?, amount?, contact_id?, due_at? }
 * Logs a call / text / email / mailer / visit / offer / note, or opens a task
 * (kind `task` + due_at). 201 with the row.
 */
export const POST = withAuth<Params>(async (req, user, { params }) => {
  const rl = rateLimit("activities:post", user.id, 240);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, ActivityCreate, { maxBytes: 16_384 });
  if (!body.ok) return body.res;
  const d = body.data;
  const input = {
    kind: d.kind as Activity["kind"],
    body: d.body,
    outcome: d.outcome || null,
    amount: d.amount ?? null,
    contact_id: d.contact_id || null,
    due_at: d.kind === "task" && d.due_at ? new Date(d.due_at).toISOString() : null,
    created_by: user.email || "operator",
  };

  const db = getServiceSupabase();
  let activity: unknown;
  if (db) {
    const { data: existing } = await db
      .from("properties")
      .select("id")
      .eq("id", params.id)
      .is("archived_at", null)
      .maybeSingle();
    if (!existing) return apiError("Property not found", 404);
    if (input.contact_id) {
      const { data: c } = await db
        .from("contacts")
        .select("id")
        .eq("id", input.contact_id)
        .eq("property_id", params.id)
        .maybeSingle();
      if (!c) return apiError("contact_id does not belong to this property", 400);
    }
    const { data, error } = await db
      .from("activities")
      .insert({ ...input, property_id: params.id })
      .select()
      .single();
    if (error || !data) {
      console.error("[activities] insert failed", error?.code);
      return apiError("Could not log the activity", 500);
    }
    activity = data;
  } else {
    activity = mockCreateActivity(params.id, input);
    if (!activity) return apiError("Property not found", 404);
  }

  await pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: input.kind === "task" ? "task.created" : "activity.logged",
    subjectType: "property",
    subjectId: params.id,
    detail: {
      kind: input.kind,
      outcome: input.outcome,
      amount: input.amount,
      due_at: input.due_at,
      summary: input.body.slice(0, 140),
    },
  });
  return NextResponse.json({ activity }, { status: 201 });
});
