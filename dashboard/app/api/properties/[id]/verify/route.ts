import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchVerifications } from "@/lib/data";
import { mockRecordVerification, mockScans } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { Verify } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Weeks a false positive / occupied verdict suppresses auto re-flagging. */
const SNOOZE_WEEKS = 8;

type Params = { params: { id: string } };

/**
 * POST /api/properties/[id]/verify { verdict, note?, scanId? }
 *
 * Records the operator's verdict (audited via property.verified). Demoting
 * verdicts (false_positive / occupied) put the parcel back to `active`, clear
 * first_flagged_at and snooze the auto-flag trigger for 8 weeks so the same
 * lawn does not re-flag next Tuesday. `needs_recheck` leaves status alone.
 */
export const POST = withAuth<Params>(async (req, user, { params }) => {
  const rl = rateLimit("properties:verify", user.id, 60);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, Verify, { maxBytes: 8_192 });
  if (!body.ok) return body.res;
  const { verdict } = body.data;
  const note = body.data.note || null;
  const scanId = body.data.scanId || null;
  const demote = verdict === "false_positive" || verdict === "occupied";
  const now = new Date();
  const verifiedBy = user.email || "operator";

  const db = getServiceSupabase();
  let verification: unknown;
  let property: unknown;

  if (db) {
    const { data: existing, error: lookupErr } = await db
      .from("properties")
      .select("id, status")
      .eq("id", params.id)
      .is("archived_at", null)
      .maybeSingle();
    if (lookupErr) {
      console.error("[verify] lookup failed", lookupErr.code);
      return apiError("Could not load the property", 500);
    }
    if (!existing) return apiError("Property not found", 404);

    // The scan must belong to this parcel; a foreign or fabricated id is a 400,
    // not a Postgres error surfaced as a 500.
    if (scanId) {
      const { data: scan } = await db
        .from("property_scans")
        .select("id")
        .eq("id", scanId)
        .eq("property_id", params.id)
        .maybeSingle();
      if (!scan) return apiError("scanId does not belong to this property", 400);
    }

    const { data: v, error: vErr } = await db
      .from("property_verifications")
      .insert({ property_id: params.id, scan_id: scanId, verdict, note, verified_by: verifiedBy })
      .select()
      .single();
    if (vErr) {
      console.error("[verify] insert failed", vErr.code);
      return apiError("Could not record the verdict", 500);
    }
    verification = v;

    const patch: Record<string, unknown> = {
      verification: verdict,
      verified_at: now.toISOString(),
    };
    if (demote) {
      patch.status = "active";
      patch.first_flagged_at = null;
      patch.snoozed_until = new Date(now.getTime() + SNOOZE_WEEKS * 7 * 86_400_000).toISOString();
    }
    const { data: p, error: pErr } = await db
      .from("properties")
      .update(patch)
      .eq("id", params.id)
      .select()
      .single();
    if (pErr) {
      console.error("[verify] property update failed", pErr.code);
      return apiError("Verdict recorded but the property could not be updated", 500);
    }
    property = p;
  } else {
    if (scanId && !mockScans(params.id).some((s) => s.id === scanId)) {
      return apiError("scanId does not belong to this property", 400);
    }
    const res = mockRecordVerification({
      property_id: params.id,
      verdict,
      note,
      scan_id: scanId,
      verified_by: verifiedBy,
    });
    if (!res) return apiError("Property not found", 404);
    verification = res.verification;
    property = res.property;
  }

  pushEvent({
    actor: verifiedBy,
    actorUserId: user.id,
    eventType: "property.verified",
    subjectType: "property",
    subjectId: params.id,
    detail: { verdict, scan_id: scanId, demoted: demote, note: note ? note.slice(0, 140) : null },
  });
  return NextResponse.json({ verification, property });
});

/** GET /api/properties/[id]/verify — verification history. */
export const GET = withAuth<Params>(async (_req, _user, { params }) => {
  return NextResponse.json({ verifications: await fetchVerifications(params.id) });
});
