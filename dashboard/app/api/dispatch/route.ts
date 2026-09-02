import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { Dispatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { safePostJson, WebhookError } from "@/lib/server/safe-fetch";

export const dynamic = "force-dynamic";

/**
 * POST /api/dispatch  { propertyId, scanId? }
 *
 * Fired after an operator manually verifies the imagery. Forwards the lead to
 * the configured CRM webhook (signed, timeout-bounded), then marks the
 * property `dispatched`.
 */
export const POST = withAuth(async (req, user) => {
  const rl = rateLimit("dispatch", user.id, 10);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, Dispatch, { maxBytes: 2_048 });
  if (!body.ok) return body.res;
  const { propertyId, scanId } = body.data;

  const db = getServiceSupabase();
  const webhook = process.env.CRM_WEBHOOK_URL;

  // Never forward mock/unverified data to a real CRM.
  if (!db && webhook) {
    return apiError("dispatch requires Supabase to be configured", 503);
  }

  // Pull authoritative lead details server-side; never trust client payloads
  // for what we forward to the CRM. Minimised: no lat/lng, no notes.
  let lead: Record<string, unknown> = { property_id: propertyId, scan_id: scanId ?? null };
  if (db) {
    const { data, error } = await db
      .from("properties")
      .select("id, parcel_id, address, status, first_flagged_at")
      .eq("id", propertyId)
      .maybeSingle();
    if (error || !data) return apiError("Property not found", 404);
    if (data.status === "dispatched") return apiError("Property already dispatched", 409);

    if (scanId) {
      const { data: scan } = await db
        .from("property_scans")
        .select("id")
        .eq("id", scanId)
        .eq("property_id", propertyId)
        .maybeSingle();
      if (!scan) return apiError("scanId does not belong to this property", 400);
    }

    lead = {
      property_id: data.id,
      parcel_id: data.parcel_id,
      address: data.address,
      status: data.status,
      first_flagged_at: data.first_flagged_at,
      scan_id: scanId ?? null,
    };
  }

  let forwarded = false;
  if (webhook) {
    try {
      const { status } = await safePostJson(webhook, {
        source: "hawkeye",
        event: "distressed_property_lead",
        dispatched_at: new Date().toISOString(),
        lead,
      });
      if (status < 200 || status >= 300) {
        return apiError(`CRM webhook responded ${status}`, 502);
      }
      forwarded = true;
    } catch (err) {
      const reason = err instanceof WebhookError ? err.message : "webhook request failed";
      console.error("[dispatch] webhook failed", reason);
      return apiError(`CRM webhook failed: ${reason}`, 502);
    }
  }

  if (db) {
    const { error } = await db
      .from("properties")
      .update({ status: "dispatched" })
      .eq("id", propertyId);
    if (error) {
      console.error("[dispatch] status update failed", error.code);
      return NextResponse.json(
        { error: "CRM notified but status update failed", forwarded },
        { status: 500 },
      );
    }
  }

  pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "lead.dispatched",
    subjectType: "property",
    subjectId: propertyId,
    detail: { scan_id: scanId ?? null, forwarded },
  });

  return NextResponse.json({ ok: true, forwarded });
});
