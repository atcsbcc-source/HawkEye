import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { mockUpdateActivity } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { ActivityPatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type Params = { params: { id: string; activityId: string } };

/**
 * PATCH /api/properties/[id]/activities/[activityId]
 * { completed?, body?, outcome?, due_at? } — `completed` only applies to tasks.
 */
export const PATCH = withAuth<Params>(async (req, user, { params }) => {
  const rl = rateLimit("activities:patch", user.id, 240);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, ActivityPatch, { maxBytes: 16_384 });
  if (!body.ok) return body.res;
  const { completed, ...rest } = body.data;
  const patch: Record<string, unknown> = { ...rest };
  if ("outcome" in patch && !patch.outcome) patch.outcome = null;
  if ("due_at" in patch)
    patch.due_at = patch.due_at ? new Date(String(patch.due_at)).toISOString() : null;
  if (completed !== undefined) patch.completed_at = completed ? new Date().toISOString() : null;

  const db = getServiceSupabase();
  let activity: { kind?: string } | null;
  if (db) {
    const { data: current, error: curErr } = await db
      .from("activities")
      .select("id, kind")
      .eq("id", params.activityId)
      .eq("property_id", params.id)
      .maybeSingle();
    if (curErr) {
      console.error("[activities] lookup failed", curErr.code);
      return apiError("Could not load the activity", 500);
    }
    if (!current) return apiError("Activity not found", 404);
    if (current.kind !== "task" && ("completed_at" in patch || "due_at" in patch)) {
      return apiError("Only tasks can be completed or rescheduled", 400);
    }
    const { data, error } = await db
      .from("activities")
      .update(patch)
      .eq("id", params.activityId)
      .select()
      .single();
    if (error || !data) {
      console.error("[activities] update failed", error?.code);
      return apiError("Could not update the activity", 500);
    }
    activity = data;
  } else {
    const current = mockUpdateActivity(params.id, params.activityId, {});
    if (!current) return apiError("Activity not found", 404);
    if (current.kind !== "task" && ("completed_at" in patch || "due_at" in patch)) {
      return apiError("Only tasks can be completed or rescheduled", 400);
    }
    activity = mockUpdateActivity(params.id, params.activityId, patch);
  }

  await pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType:
      completed === true
        ? "task.completed"
        : completed === false
          ? "task.reopened"
          : "activity.updated",
    subjectType: "property",
    subjectId: params.id,
    detail: { activity_id: params.activityId, fields: Object.keys(patch) },
  });
  return NextResponse.json({ activity });
});
