import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { Dispatch } from "@/lib/server/schemas";
import { apiError, parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { safePostJson, WebhookError } from "@/lib/server/safe-fetch";
import { mockGetProperty, mockScans, mockUpdateProperty } from "@/lib/server/mock-store";
import type { LeadStatus, VerificationVerdict } from "@/lib/types";

export const dynamic = "force-dynamic";

interface LeadRow {
  id: string;
  parcel_id: string;
  address: string;
  status: LeadStatus;
  first_flagged_at: string | null;
  verification: VerificationVerdict | null;
}

/**
 * POST /api/dispatch  { propertyId, scanId? }
 *
 * Fired after an operator manually verifies the imagery. Forwards the lead to
 * the configured CRM webhook (signed, timeout-bounded), then marks the
 * property `dispatched`. The verdict gate the UI shows is enforced here too:
 * a lead whose verdict is anything but `verified_vacant` is never dispatched.
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
  let row: LeadRow;
  if (db) {
    const { data, error } = await db
      .from("properties")
      .select("id, parcel_id, address, status, first_flagged_at, verification")
      .eq("id", propertyId)
      .is("archived_at", null)
      .maybeSingle();
    if (error || !data) return apiError("Property not found", 404);
    row = data as LeadRow;

    if (scanId) {
      const { data: scan } = await db
        .from("property_scans")
        .select("id")
        .eq("id", scanId)
        .eq("property_id", propertyId)
        .maybeSingle();
      if (!scan) return apiError("scanId does not belong to this property", 400);
    }
  } else {
    const lead = mockGetProperty(propertyId);
    if (!lead) return apiError("Property not found", 404);
    row = {
      id: lead.id,
      parcel_id: lead.parcel_id,
      address: lead.address,
      status: lead.status,
      first_flagged_at: lead.first_flagged_at,
      verification: lead.verification ?? null,
    };
    if (scanId && !mockScans(propertyId).some((s) => s.id === scanId)) {
      return apiError("scanId does not belong to this property", 400);
    }
  }

  if (row.status === "dispatched") return apiError("Property already dispatched", 409);
  if (row.verification && row.verification !== "verified_vacant") {
    return apiError(
      `Verdict is ${row.verification}; only verified_vacant leads can be dispatched`,
      409,
    );
  }

  const lead = {
    property_id: row.id,
    parcel_id: row.parcel_id,
    address: row.address,
    status: row.status,
    first_flagged_at: row.first_flagged_at,
    scan_id: scanId ?? null,
  };

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
  } else {
    mockUpdateProperty(propertyId, { status: "dispatched" });
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
