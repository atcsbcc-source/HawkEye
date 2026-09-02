import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { mockSetStage } from "@/lib/server/mock-store";
import { evaluateRules, pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { StageChange } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import type { CrmStage } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/**
 * POST /api/properties/[id]/stage { stage, note? }
 *
 * Moves the parcel through the deal pipeline, writes the stage_change
 * activity, audits it and fires `stage_changed` rules. Setting the current
 * stage again is a 200 no-op (`changed: false`).
 */
export const POST = withAuth<Params>(async (req, user, { params }) => {
  const rl = rateLimit("properties:stage", user.id, 120);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, StageChange, { maxBytes: 8_192 });
  if (!body.ok) return body.res;
  const stage = body.data.stage as CrmStage;
  const note = body.data.note || null;
  const by = user.email || "operator";

  const db = getServiceSupabase();
  let property: unknown;
  let previous: CrmStage | null;

  if (db) {
    const { data: current, error: lookupErr } = await db
      .from("properties")
      .select("id, crm_stage")
      .eq("id", params.id)
      .is("archived_at", null)
      .maybeSingle();
    if (lookupErr) {
      console.error("[stage] lookup failed", lookupErr.code);
      return apiError("Could not load the property", 500);
    }
    if (!current) return apiError("Property not found", 404);
    previous = (current.crm_stage as CrmStage) ?? "new";
    if (previous === stage) {
      return NextResponse.json({ changed: false, property: current });
    }
    const now = new Date().toISOString();
    const { data: updated, error } = await db
      .from("properties")
      .update({ crm_stage: stage, stage_changed_at: now })
      .eq("id", params.id)
      .select()
      .single();
    if (error || !updated) {
      console.error("[stage] update failed", error?.code);
      return apiError("Could not change the stage", 500);
    }
    property = updated;
    const { error: actErr } = await db.from("activities").insert({
      property_id: params.id,
      kind: "stage_change",
      body: note ? `${previous} → ${stage} — ${note}` : `${previous} → ${stage}`,
      created_by: by,
    });
    if (actErr) console.error("[stage] activity insert failed", actErr.code);
  } else {
    const res = mockSetStage(params.id, stage, by, note);
    if (res.outcome === "not_found") return apiError("Property not found", 404);
    if (res.outcome === "unchanged") {
      return NextResponse.json({ changed: false, property: res.property });
    }
    property = res.property;
    previous = res.previous;
  }

  await pushEvent({
    actor: by,
    actorUserId: user.id,
    eventType: "property.stage_changed",
    subjectType: "property",
    subjectId: params.id,
    detail: { stage, previous_stage: previous, note: note ? note.slice(0, 140) : null },
  });
  const automation = await evaluateRules("stage_changed", {
    property_id: params.id,
    stage,
    previous_stage: previous,
  });
  return NextResponse.json({ changed: true, property, automation });
});
