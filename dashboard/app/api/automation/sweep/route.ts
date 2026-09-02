import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchLeads } from "@/lib/data";
import { evaluateRules, listRules, pushEvent } from "@/lib/server/ops";
import { mockHasFiring, mockRecordFiring, mockUpdateProperty } from "@/lib/server/mock-store";
import type { AutomationRule } from "@/lib/ops-types";

export const dynamic = "force-dynamic";

/**
 * POST|GET /api/automation/sweep
 *
 * The scheduled pass that lets `distress_threshold` rules actually fire: for
 * every flagged parcel at or past the lowest enabled min_days, evaluate the
 * rules once (idempotent via automation_rule_firings / the mock Set) and, when
 * a dispatch_webhook rule fired, mark the parcel `dispatched` so it is never
 * re-sent. Guarded by `Authorization: Bearer $CRON_SECRET` (Vercel cron adds
 * it automatically); with no CRON_SECRET configured only same-origin calls
 * from the console are accepted so the dev button still works.
 */
export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSweep();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sweep failed" },
      { status: 500 },
    );
  }
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (secret) {
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  }
  // Dev mode: no secret configured — allow only same-origin browser calls.
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;
  const host = req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (host && origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

interface SweepResult {
  scanned: number;
  fired: number;
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

  // Candidates: flagged parcels past the lowest threshold.
  let candidates: Candidate[];
  if (db) {
    const { data, error } = await db
      .from("distressed_properties")
      .select("id, parcel_id, address, days_distressed, latest_vacancy_confidence")
      .eq("status", "flagged")
      .gte("days_distressed", minDays);
    if (error) throw new Error(error.message);
    candidates = (data ?? []) as Candidate[];
  } else {
    candidates = (await fetchLeads())
      .filter((l) => l.status === "flagged" && (l.days_distressed ?? 0) >= minDays)
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
    const { data } = await db
      .from("automation_rule_firings")
      .select("rule_id, subject_id")
      .eq("subject_type", "property")
      .in(
        "rule_id",
        rules.map((r) => r.id),
      );
    for (const row of data ?? []) ledger.add(`${row.rule_id}:${row.subject_id}`);
  }
  const hasFiring = (ruleId: string, propertyId: string) =>
    db ? ledger.has(`${ruleId}:${propertyId}`) : mockHasFiring(ruleId, propertyId);

  let fired = 0;
  let skipped = 0;
  let dispatched = 0;

  for (const c of candidates) {
    const applicable = rules.filter((r) => c.days_distressed >= minDaysOf(r));
    const pending = applicable.filter((r) => !hasFiring(r.id, c.id));
    if (pending.length === 0) {
      skipped++;
      continue;
    }

    const result = await evaluateRules("distress_threshold", {
      property_id: c.id,
      parcel_id: c.parcel_id,
      address: c.address,
      days_distressed: c.days_distressed,
      latest_vacancy_confidence: c.latest_vacancy_confidence,
    });
    const firedRules = rules.filter((r) => result.fired.includes(r.name));
    fired += firedRules.length;

    if (firedRules.length > 0) {
      if (db) {
        await db.from("automation_rule_firings").upsert(
          firedRules.map((r) => ({ rule_id: r.id, subject_type: "property", subject_id: c.id })),
          { onConflict: "rule_id,subject_type,subject_id", ignoreDuplicates: true },
        );
      } else {
        for (const r of firedRules) mockRecordFiring(r.id, c.id);
      }
    }

    if (firedRules.some((r) => r.actionType === "dispatch_webhook")) {
      if (db) {
        await db
          .from("properties")
          .update({ status: "dispatched" })
          .eq("id", c.id)
          .eq("status", "flagged");
      } else {
        mockUpdateProperty(c.id, { status: "dispatched" });
      }
      dispatched++;
    }
  }

  return emit({
    scanned: candidates.length,
    fired,
    skipped,
    dispatched,
    minDays,
    rules: rules.length,
    ranAt,
  });
}
