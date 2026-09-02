/**
 * Rule actions with injected side effects. Nothing here imports lib/supabase
 * or lib/server so the module stays unit-testable; the server
 * (lib/server/rules.ts) injects the real dependencies — the SSRF-safe, signed
 * `postJson` from lib/server/safe-fetch and the mock-store flagger.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTO_FLAG_CONFIDENCE } from "../constants";
import type { AutomationRule } from "../ops-types";
import { num, str } from "./evaluate";

/** Result of a store-backed flag attempt (mock mode). */
export type FlagOutcome = "flagged" | "already_flagged" | "not_flaggable";
/** Result of a store-backed stage change (mock mode). */
export type StageOutcome = "changed" | "unchanged" | "not_found";
/** Result of a store-backed task creation (mock mode). */
export type TaskOutcome = "created" | "exists" | "not_found";

export interface ActionDeps {
  db: SupabaseClient | null;
  /** POST a JSON body; resolves with the HTTP status, rejects on network failure. */
  postJson: (url: string, body: unknown) => Promise<{ status: number }>;
  /**
   * Optional store-backed flagger used when `db` is null (mock mode), so the
   * scan -> auto-flag -> sweep routine works end-to-end without Supabase.
   * `not_flaggable` covers unknown, archived, dispatched and snoozed parcels.
   */
  flagWithoutDb?: (propertyId: string) => FlagOutcome;
  /** Mock-mode stage setter (set_stage). */
  setStageWithoutDb?: (propertyId: string, stage: string, by: string) => StageOutcome;
  /** Mock-mode task creator (create_task); `exists` = an open task from this rule is already there. */
  createTaskWithoutDb?: (
    propertyId: string,
    title: string,
    dueAt: string,
    by: string,
  ) => TaskOutcome;
}

export interface ActionResult {
  ok: boolean;
  /**
   * True when the action ran but changed nothing (parcel already flagged,
   * unknown, snoozed, below threshold). Not a firing: callers must not bump
   * fire_count or audit it as one.
   */
  skipped?: boolean;
  /** Optional audit event describing the side effect (emitted by the caller). */
  eventType?: string;
  detail: Record<string, unknown>;
}

const skip = (detail: Record<string, unknown>): ActionResult => ({
  ok: true,
  skipped: true,
  detail,
});

/** Execute a rule's action. Reports failures in the result; only throws on DB errors. */
export async function executeAction(
  rule: AutomationRule,
  payload: Record<string, unknown>,
  deps: ActionDeps,
): Promise<ActionResult> {
  switch (rule.actionType) {
    case "flag_property":
      return flagProperty(rule, payload, deps);
    case "dispatch_webhook":
      return dispatchWebhook(rule, payload, deps);
    case "notify":
      // The rule.fired audit event doubles as the notification channel until
      // email/Slack is wired.
      return { ok: true, detail: {} };
    case "set_stage":
      return setStage(rule, payload, deps);
    case "create_task":
      return createTask(rule, payload, deps);
    default:
      return { ok: false, detail: { reason: "unknown action" } };
  }
}

async function flagProperty(
  rule: AutomationRule,
  payload: Record<string, unknown>,
  { db, flagWithoutDb }: ActionDeps,
): Promise<ActionResult> {
  const propertyId = payload.property_id;
  if (typeof propertyId !== "string" || !propertyId) {
    return skip({ skipped: "no property_id" });
  }
  const min = num(rule.triggerConfig.min_confidence, AUTO_FLAG_CONFIDENCE);
  if (!db) {
    if (!flagWithoutDb) return skip({ skipped: "no database" });
    // Mock mode has no scan table to re-read; the payload confidence is the
    // only signal and the trigger condition already checked it against `min`.
    const confidence = num(payload.vacancy_confidence, -1);
    if (confidence < min) return skip({ skipped: "below threshold", confidence, min });
    const outcome = flagWithoutDb(propertyId);
    if (outcome !== "flagged") {
      return skip({ skipped: outcome.replace("_", " "), property_id: propertyId });
    }
    return {
      ok: true,
      eventType: "property.flagged",
      detail: { property_id: propertyId, confidence },
    };
  }
  // The payload is only a hint: re-read the latest scan so a spoofed or stale
  // confidence can never flag a property the database disagrees with.
  const { data: scan, error: scanErr } = await db
    .from("property_scans")
    .select("vacancy_confidence")
    .eq("property_id", propertyId)
    .order("processed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (scanErr) throw new Error(`select property_scans: ${scanErr.message}`);
  const confidence = num(scan?.vacancy_confidence, -1);
  if (confidence < min) return skip({ skipped: "below threshold", confidence, min });

  // Same predicate as the auto_flag_property() trigger: never touch archived,
  // dispatched or snoozed parcels, and never re-flag one already flagged.
  const { data: current, error: curErr } = await db
    .from("properties")
    .select("status, first_flagged_at, archived_at, snoozed_until")
    .eq("id", propertyId)
    .maybeSingle();
  if (curErr) throw new Error(`select properties: ${curErr.message}`);
  const nowMs = Date.now();
  if (!current || current.archived_at) {
    return skip({ skipped: "not flaggable", property_id: propertyId });
  }
  if (current.status === "flagged") {
    return skip({ skipped: "already flagged", property_id: propertyId });
  }
  if (current.status === "dispatched") {
    return skip({ skipped: "not flaggable", property_id: propertyId, status: current.status });
  }
  if (current.snoozed_until && new Date(current.snoozed_until).getTime() > nowMs) {
    return skip({ skipped: "snoozed", property_id: propertyId, until: current.snoozed_until });
  }
  const { data: updated, error } = await db
    .from("properties")
    .update({
      status: "flagged",
      first_flagged_at: current.first_flagged_at ?? new Date(nowMs).toISOString(),
    })
    .eq("id", propertyId)
    .eq("status", current.status)
    .is("archived_at", null)
    .select("id");
  if (error) throw new Error(`update properties: ${error.message}`);
  if (!updated || updated.length === 0) {
    // Lost a race with the trigger / an operator verdict — nothing changed here.
    return skip({ skipped: "not flaggable", property_id: propertyId });
  }
  return {
    ok: true,
    eventType: "property.flagged",
    detail: { property_id: propertyId, confidence },
  };
}

async function dispatchWebhook(
  rule: AutomationRule,
  payload: Record<string, unknown>,
  { postJson }: ActionDeps,
): Promise<ActionResult> {
  const url = String(rule.actionConfig.url ?? process.env.CRM_WEBHOOK_URL ?? "");
  if (!url) {
    // Audited as a failed delivery so the sweep leaves the lead flagged and
    // the operator can see why nothing reached the CRM.
    return {
      ok: false,
      eventType: "webhook.failed",
      detail: { error: "no webhook url configured", kind: "unconfigured" },
    };
  }
  const started = Date.now();
  try {
    const { status } = await postJson(url, {
      source: "hawkeye-automation",
      rule: rule.name,
      payload,
    });
    const ms = Date.now() - started;
    const ok = status >= 200 && status < 300;
    return {
      ok,
      eventType: ok ? "webhook.delivered" : "webhook.failed",
      detail: { status, ms },
    };
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    // safe-fetch's WebhookError carries a `kind` (unsafe_url|timeout|network|http).
    const kind = (err as { kind?: unknown })?.kind;
    return {
      ok: false,
      eventType: "webhook.failed",
      detail: { error: message, ms, ...(typeof kind === "string" ? { kind } : {}) },
    };
  }
}

// ---------------------------------------------------------------------------
// Workflow actions
// ---------------------------------------------------------------------------
const STAGES = new Set([
  "new",
  "verified",
  "researching",
  "outreach",
  "negotiating",
  "under_contract",
  "closed_won",
  "closed_lost",
]);

/** Move the parcel to `actionConfig.stage`; a no-op when it is already there. */
async function setStage(
  rule: AutomationRule,
  payload: Record<string, unknown>,
  { db, setStageWithoutDb }: ActionDeps,
): Promise<ActionResult> {
  const propertyId = payload.property_id;
  if (typeof propertyId !== "string" || !propertyId) {
    return skip({ skipped: "no property_id" });
  }
  const stage = str(rule.actionConfig.stage);
  if (!STAGES.has(stage)) return { ok: false, detail: { error: "invalid stage", stage } };
  const by = `rule:${rule.id}`;
  if (!db) {
    if (!setStageWithoutDb) return skip({ skipped: "no database" });
    const outcome = setStageWithoutDb(propertyId, stage, by);
    if (outcome !== "changed") {
      return skip({ skipped: outcome.replace("_", " "), property_id: propertyId, stage });
    }
    return {
      ok: true,
      eventType: "property.stage_changed",
      detail: { property_id: propertyId, stage },
    };
  }
  const { data: current, error: curErr } = await db
    .from("properties")
    .select("crm_stage, archived_at")
    .eq("id", propertyId)
    .maybeSingle();
  if (curErr) throw new Error(`select properties: ${curErr.message}`);
  if (!current || current.archived_at) {
    return skip({ skipped: "not found", property_id: propertyId });
  }
  if (current.crm_stage === stage) {
    return skip({ skipped: "unchanged", property_id: propertyId, stage });
  }
  const now = new Date().toISOString();
  const { error } = await db
    .from("properties")
    .update({ crm_stage: stage, stage_changed_at: now })
    .eq("id", propertyId)
    .is("archived_at", null);
  if (error) throw new Error(`update properties.crm_stage: ${error.message}`);
  const { error: actErr } = await db.from("activities").insert({
    property_id: propertyId,
    kind: "stage_change",
    body: `${current.crm_stage} → ${stage}`,
    created_by: by,
  });
  if (actErr) throw new Error(`insert activities: ${actErr.message}`);
  return {
    ok: true,
    eventType: "property.stage_changed",
    detail: { property_id: propertyId, stage, previous_stage: current.crm_stage },
  };
}

/** Open a follow-up task on the parcel, due `due_in_days` from now (default 3). */
async function createTask(
  rule: AutomationRule,
  payload: Record<string, unknown>,
  { db, createTaskWithoutDb }: ActionDeps,
): Promise<ActionResult> {
  const propertyId = payload.property_id;
  if (typeof propertyId !== "string" || !propertyId) {
    return skip({ skipped: "no property_id" });
  }
  const title = str(rule.actionConfig.title).slice(0, 200);
  if (!title) return { ok: false, detail: { error: "task title missing" } };
  const days = Math.min(365, Math.max(0, num(rule.actionConfig.due_in_days, 3)));
  const dueAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const by = `rule:${rule.id}`;
  if (!db) {
    if (!createTaskWithoutDb) return skip({ skipped: "no database" });
    const outcome = createTaskWithoutDb(propertyId, title, dueAt, by);
    if (outcome === "not_found") return skip({ skipped: "not found", property_id: propertyId });
    if (outcome === "exists")
      return skip({ skipped: "task already open", property_id: propertyId });
    return {
      ok: true,
      eventType: "task.created",
      detail: { property_id: propertyId, title, due_at: dueAt },
    };
  }
  const { data: current, error: curErr } = await db
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .is("archived_at", null)
    .maybeSingle();
  if (curErr) throw new Error(`select properties: ${curErr.message}`);
  if (!current) return skip({ skipped: "not found", property_id: propertyId });
  // One open task per (rule, parcel): re-running the trigger must not pile up duplicates.
  const { data: open, error: openErr } = await db
    .from("activities")
    .select("id")
    .eq("property_id", propertyId)
    .eq("kind", "task")
    .eq("created_by", by)
    .is("completed_at", null)
    .limit(1);
  if (openErr) throw new Error(`select activities: ${openErr.message}`);
  if (open && open.length > 0) {
    return skip({ skipped: "task already open", property_id: propertyId, activity_id: open[0].id });
  }
  const { data: task, error } = await db
    .from("activities")
    .insert({ property_id: propertyId, kind: "task", body: title, due_at: dueAt, created_by: by })
    .select("id")
    .single();
  if (error) throw new Error(`insert activities: ${error.message}`);
  return {
    ok: true,
    eventType: "task.created",
    detail: { property_id: propertyId, title, due_at: dueAt, activity_id: task?.id },
  };
}
