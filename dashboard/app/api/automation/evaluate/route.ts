import { NextResponse, type NextRequest } from "next/server";
import { evaluateRules } from "@/lib/server/ops";
import { AuthError, requirePipelineToken, requireUser, authErrorResponse } from "@/lib/server/auth";
import { Evaluate } from "@/lib/server/schemas";
import { parseJson } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST { trigger, payload } — fire the automation engine for an external
 * event. The CV pipeline calls this after each scan upsert with
 * `Authorization: Bearer $HAWKEYE_PIPELINE_TOKEN`; an admin session is also
 * accepted (manual re-evaluation from the console).
 */
export async function POST(req: NextRequest) {
  let subject: string;
  const token = requirePipelineToken(req, "HAWKEYE_PIPELINE_TOKEN");
  if (token) {
    subject = `token:${token.name}`;
  } else {
    try {
      const user = await requireUser({ role: "admin" });
      subject = `user:${user.id}`;
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }
  }

  const rl = rateLimit("automation:evaluate", subject, 300);
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await parseJson(req, Evaluate, { maxBytes: 8_192 });
  if (!body.ok) return body.res;
  const { trigger, payload } = body.data;

  // distress_threshold rules only run from the ledgered sweep: evaluating them
  // here would bypass automation_rule_firings and the `dispatched` flip, so a
  // lead could be delivered to the CRM on every call.
  if (trigger === "distress_threshold") {
    return NextResponse.json(
      { error: "distress_threshold rules run from POST /api/automation/sweep (ledgered)" },
      { status: 400 },
    );
  }

  // Forward only the allowlisted projection — never the raw object.
  const projected: Record<string, unknown> = {};
  for (const key of [
    "property_id",
    "parcel_id",
    "vacancy_confidence",
    "days_distressed",
    "missionId",
    "name",
  ] as const) {
    const v = (payload as Record<string, unknown>)[key];
    if (v !== undefined) projected[key] = v;
  }

  const result = await evaluateRules(trigger, projected);
  return NextResponse.json(result);
}
