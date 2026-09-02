import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { mockRecordVerification } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { getUser } from "@/lib/server/auth";
import { VERIFICATION_VERDICTS, type VerificationVerdict } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Weeks a false positive / occupied verdict suppresses auto re-flagging. */
const SNOOZE_WEEKS = 8;

const VerifySchema = z.object({
  verdict: z.enum(VERIFICATION_VERDICTS as [VerificationVerdict, ...VerificationVerdict[]]),
  note: z.string().trim().max(2000).nullish(),
  scanId: z.string().trim().min(1).max(80).nullish(),
});

/**
 * POST /api/properties/[id]/verify { verdict, note?, scanId? }
 *
 * Records the operator's verdict (audited via property.verified). Demoting
 * verdicts (false_positive / occupied) put the parcel back to `active`, clear
 * first_flagged_at and snooze the auto-flag trigger for 8 weeks so the same
 * lawn does not re-flag next Tuesday. `needs_recheck` leaves status alone.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return NextResponse.json({ error }, { status: 400 });
  }
  const { verdict } = parsed.data;
  const note = parsed.data.note || null;
  const scanId = parsed.data.scanId || null;
  const demote = verdict === "false_positive" || verdict === "occupied";
  const now = new Date();

  // Middleware already gates this route; resolve the session for attribution.
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const verifiedBy = user.email || "operator";

  const db = getServiceSupabase();
  let verification: unknown;
  let property: unknown;

  if (db) {
    const { data: existing } = await db
      .from("properties")
      .select("id, status")
      .eq("id", params.id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    const { data: v, error: vErr } = await db
      .from("property_verifications")
      .insert({ property_id: params.id, scan_id: scanId, verdict, note, verified_by: verifiedBy })
      .select()
      .single();
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
    verification = v;

    const patch: Record<string, unknown> = { verification: verdict, verified_at: now.toISOString() };
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
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    property = p;
  } else {
    const res = mockRecordVerification({
      property_id: params.id,
      verdict,
      note,
      scan_id: scanId,
      verified_by: verifiedBy,
    });
    if (!res) return NextResponse.json({ error: "Property not found" }, { status: 404 });
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
}

/** GET /api/properties/[id]/verify — verification history. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { fetchVerifications } = await import("@/lib/data");
  return NextResponse.json({ verifications: await fetchVerifications(params.id) });
}
