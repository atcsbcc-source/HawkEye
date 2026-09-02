import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchLeads } from "@/lib/data";
import { evaluateRules, listRules, pushEvent, DbError } from "@/lib/server/ops";
import { must } from "@/lib/server/db";
import { AuthError, authErrorResponse, requirePipelineToken, requireUser } from "@/lib/server/auth";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { mockHasFiring, mockRecordFiring, mockUpdateProperty } from "@/lib/server/mock-store";
import type { AutomationRule } from "@/lib/ops-types";

export const dynamic = "force-dynamic";

/**
 * POST|GET /api/automation/sweep
 *
 * The scheduled pass that lets `distress_threshold` rules actually fire: for
 * every flagged parcel at or past the lowest enabled min_days, evaluate the
 * still-pending rules once and record each SUCCESSFUL firing in
 * automation_rule_firings (the mock Set in dev mode). A parcel is marked
 * `dispatched` only when a dispatch_webhook action was actually delivered
 * (2xx); failed deliveries leave it flagged so the next sweep retries.
 *
 * Callers: Vercel Cron with `Authorization: Bearer $CRON_SECRET`, or an admin
 * session from the console's "Run sweep now" button (middleware performs the
 * CSRF checks for cookie sessions). Both work regardless of whether
 * CRON_SECRET is configured.
 */
export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  let subject: string;
  const token = requirePipelineToken(req, "CRON_SECRET");
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

  const rl = rateLimit("automation:sweep", subject, 6);
  if (!rl.ok) return rateLimitResponse(rl);

  try {
    const result = await runSweep();
    return NextResponse.json(result);
  } catch (err) {
    // Never echo PostgREST / network error strings to the client.
    console.error("[sweep] failed", err instanceof DbError ? err.message : err);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

interface SweepResult {
  scanned: number;
  /** Rule actions that succeeded (ledgered). */
  fired: number;
  /** Rule actions that ran but failed (not ledgered; retried next sweep). */
  failed: number;
  skipped: number;
  dispatched: number;
  minDays: number | null;
  rules: number;
  ranAt: string;
}

interface Candidate {
  id: string;
  parcel_id: string;
  address: string;
  days_distressed: number;
  latest_vacancy_confidence: number | null;
}

async function runSweep(): Promise<SweepResult> {
  const ranAt = new Date().toISOString();
  const rules = (await listRules()).filter(
    (r) => r.enabled && r.triggerType === "distress_threshold",
  );
  const emit = (r: SweepResult) => {
    pushEvent({
      actor: "system",
      eventType: "automation.sweep",
      subjectType: "rule",
      subjectId: null,
      detail: {
        scanned: r.scanned,
        fired: r.fired,
        failed: r.failed,
        skipped: r.skipped,
        dispatched: r.dispatched,
        minDays: r.minDays,
      },
    });
    return r;
  };

  if (rules.length === 0) {
    return emit({
      scanned: 0,
      fired: 0,
      failed: 0,
      skipped: 0,
      dispatched: 0,
      minDays: null,
      rules: 0,
      ranAt,
    });
  }

  const minDaysOf = (r: AutomationRule) => Number(r.triggerConfig.min_days ?? 60);
  const minDays = Math.min(...rules.map(minDaysOf));
  const db = getServiceSupabase();

  // Candidates: flagged parcels past the lowest threshold whose verdict (if
  // any) still allows dispatch — an operator's needs_recheck holds the lead.
  let candidates: Candidate[];
  if (db) {
    const rows = await must(
      db
        .from("distressed_properties")
        .select("id, parcel_id, address, days_distressed, latest_vacancy_confidence")
        .eq("status", "flagged")
        .gte("days_distressed", minDays)
        .or("verification.is.null,verification.eq.verified_vacant"),
      "select distressed_properties",
    );
    candidates = (rows ?? []) as Candidate[];
  } else {
    candidates = (await fetchLeads())
      .filter(
        (l) =>
          l.status === "flagged" &&
          (l.days_distressed ?? 0) >= minDays &&
          (!l.verification || l.verification === "verified_vacant"),
      )
      .map((l) => ({
        id: l.id,
        parcel_id: l.parcel_id,
        address: l.address,
        days_distressed: l.days_distressed ?? 0,
        latest_vacancy_confidence: l.latest_vacancy_confidence,
      }));
  }

  // Firing ledger for these rules.
  const ledger = new Set<string>();
  if (db) {
    const rows = await must(
      db
        .from("automation_rule_firings")
        .select("rule_id, subject_id")
        .eq("subject_type", "property")
        .in(
          "rule_id",
          rules.map((r) => r.id),
        ),
      "select automation_rule_firings",
    );
    for (const row of rows ?? []) ledger.add(`${row.rule_id}:${row.subject_id}`);
  }
  const hasFiring = (ruleId: string, propertyId: string) =>
    db ? ledger.has(`${ruleId}:${propertyId}`) : mockHasFiring(ruleId, propertyId);

  let fired = 0;
  let failed = 0;
  let skipped = 0;
  let dispatched = 0;

  for (const c of candidates) {
    const applicable = rules.filter((r) => c.days_distressed >= minDaysOf(r));
    const pending = applicable.filter((r) => !hasFiring(r.id, c.id));
    if (pending.length === 0) {
      skipped++;
      continue;
    }

    // Only the rules still pending for this parcel run — an already-ledgered
    // rule is never re-fired because a sibling rule was added later.
    const result = await evaluateRules(
      "distress_threshold",
      {
        property_id: c.id,
        parcel_id: c.parcel_id,
        address: c.address,
        days_distressed: c.days_distressed,
        latest_vacancy_confidence: c.latest_vacancy_confidence,
      },
      { only: pending.map((r) => r.id) },
    );
    const succeeded = result.outcomes.filter((o) => o.ok);
    fired += succeeded.length;
    failed += result.outcomes.length - succeeded.length;

    if (succeeded.length > 0) {
      if (db) {
        await must(
          db.from("automation_rule_firings").upsert(
            succeeded.map((o) => ({ rule_id: o.id, subject_type: "property", subject_id: c.id })),
            { onConflict: "rule_id,subject_type,subject_id", ignoreDuplicates: true },
          ),
          "upsert automation_rule_firings",
        );
      } else {
        for (const o of succeeded) mockRecordFiring(o.id, c.id);
      }
    }

    if (succeeded.some((o) => o.actionType === "dispatch_webhook")) {
      if (db) {
        await must(
          db
            .from("properties")
            .update({ status: "dispatched" })
            .eq("id", c.id)
            .eq("status", "flagged"),
          "update properties.status",
        );
      } else {
        mockUpdateProperty(c.id, { status: "dispatched" });
      }
      dispatched++;
    }
  }

  return emit({
    scanned: candidates.length,
    fired,
    failed,
    skipped,
    dispatched,
    minDays,
    rules: rules.length,
    ranAt,
  });
}
