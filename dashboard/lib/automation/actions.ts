/**
 * Rule actions with injected side effects. Nothing here imports lib/supabase
 * or lib/server so the module stays unit-testable; the server
 * (lib/server/rules.ts) injects the real dependencies — the SSRF-safe, signed
 * `postJson` from lib/server/safe-fetch and the mock-store flagger.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTO_FLAG_CONFIDENCE } from "../constants";
import type { AutomationRule } from "../ops-types";
import { num } from "./evaluate";

/** Result of a store-backed flag attempt (mock mode). */
export type FlagOutcome = "flagged" | "already_flagged" | "not_flaggable";

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
