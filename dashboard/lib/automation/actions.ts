/**
 * Rule actions with injected side effects. Nothing here imports lib/supabase
 * or lib/server so the module stays unit-testable; the server passes real
 * dependencies via `defaultActionDeps(db)`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTO_FLAG_CONFIDENCE } from "../constants";
import type { AutomationRule } from "../ops-types";
import { num } from "./evaluate";

export interface ActionDeps {
  db: SupabaseClient | null;
  /** POST a JSON body; resolves with the HTTP status, rejects on network failure. */
  postJson: (url: string, body: unknown) => Promise<{ status: number }>;
  /**
   * Optional store-backed flagger used when `db` is null (mock mode), so the
   * scan -> auto-flag -> sweep routine works end-to-end without Supabase.
   * Returns false when the parcel is unknown, dispatched or snoozed.
   */
  flagWithoutDb?: (propertyId: string) => boolean;
}

export interface ActionResult {
  ok: boolean;
  /** Optional audit event describing the side effect (emitted by the caller). */
  eventType?: string;
  detail: Record<string, unknown>;
}

export const WEBHOOK_TIMEOUT_MS = 8_000;

/**
 * Plain-fetch webhook poster: bounded by a timeout, never follows redirects.
 * Used only by tests / `defaultActionDeps`; the server (lib/server/rules.ts)
 * injects lib/server/safe-fetch's `postJson`, which validates the URL against
 * private/loopback ranges (SSRF) and signs the body before posting.
 */
export async function defaultPostJson(url: string, body: unknown): Promise<{ status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  return { status: res.status };
}

export function defaultActionDeps(db: SupabaseClient | null): ActionDeps {
  return { db, postJson: defaultPostJson };
}

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
    return { ok: true, detail: { skipped: "no property_id" } };
  }
  const min = num(rule.triggerConfig.min_confidence, AUTO_FLAG_CONFIDENCE);
  if (!db) {
    if (!flagWithoutDb) return { ok: true, detail: { skipped: "no database" } };
    // Mock mode has no scan table to re-read; the payload confidence is the
    // only signal and the trigger condition already checked it against `min`.
    const confidence = num(payload.vacancy_confidence, -1);
    if (confidence < min) {
      return { ok: true, detail: { skipped: "below threshold", confidence, min } };
    }
    if (!flagWithoutDb(propertyId)) {
      return { ok: true, detail: { skipped: "not flaggable", property_id: propertyId } };
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
  if (confidence < min) {
    return { ok: true, detail: { skipped: "below threshold", confidence, min } };
  }
  const { error } = await db
    .from("properties")
    .update({ status: "flagged" })
    .eq("id", propertyId)
    .neq("status", "dispatched");
  if (error) throw new Error(`update properties: ${error.message}`);
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
