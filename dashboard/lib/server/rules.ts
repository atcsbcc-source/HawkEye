import { randomUUID } from "crypto";
import { getServiceSupabase } from "../supabase";
import { AUTO_FLAG_CONFIDENCE, DISTRESS_THRESHOLD_DAYS } from "../constants";
import type { AutomationRule, TriggerType } from "../ops-types";
import { selectFiringRules } from "../automation/evaluate";
import { executeAction, type ActionDeps } from "../automation/actions";
import { postJson as safePostJson } from "./safe-fetch";
import { pushEvent } from "./audit";
import { must } from "./db";
import { getOpsState } from "./state";

/**
 * Mock-mode defaults only. In Supabase mode the same two rules are seeded by
 * supabase/migrations/20260903030000_seed_default_rules.sql with these exact
 * ids (fixed UUIDs so `id: uuid` validation and updates work in both modes).
 * There the flag rule ships disabled because the Postgres trigger is the
 * flagging authority; in mock mode there is no trigger, so it starts enabled.
 */
export const DEFAULT_RULE_IDS = {
  flag: "00000000-0000-4000-8000-000000000001",
  dispatch: "00000000-0000-4000-8000-000000000002",
} as const;

export const DEFAULT_RULES: AutomationRule[] = [
  {
    id: DEFAULT_RULE_IDS.flag,
    name: "Auto-flag high-confidence vacancies",
    triggerType: "scan_processed",
    triggerConfig: { min_confidence: AUTO_FLAG_CONFIDENCE },
    actionType: "flag_property",
    actionConfig: {},
    enabled: true,
    lastFiredAt: null,
    fireCount: 0,
  },
  {
    id: DEFAULT_RULE_IDS.dispatch,
    name: `Dispatch ${DISTRESS_THRESHOLD_DAYS}-day distressed leads to CRM`,
    triggerType: "distress_threshold",
    triggerConfig: { min_days: DISTRESS_THRESHOLD_DAYS },
    actionType: "dispatch_webhook",
    actionConfig: {},
    enabled: false,
    lastFiredAt: null,
    fireCount: 0,
  },
];

export function ruleFromRow(r: Record<string, unknown>): AutomationRule {
  return {
    id: String(r.id),
    name: String(r.name),
    triggerType: r.trigger_type as TriggerType,
    triggerConfig: (r.trigger_config as Record<string, unknown> | null) ?? {},
    actionType: r.action_type as AutomationRule["actionType"],
    actionConfig: (r.action_config as Record<string, unknown> | null) ?? {},
    enabled: Boolean(r.enabled),
    lastFiredAt: (r.last_fired_at as string | null) ?? null,
    fireCount: Number(r.fire_count ?? 0),
  };
}

/** Mock-mode store, lazily seeded with DEFAULT_RULES. */
function memoryRules(): AutomationRule[] {
  const state = getOpsState();
  if (state.rules.length === 0) state.rules = structuredClone(DEFAULT_RULES);
  return state.rules;
}

/** DB-exclusive when Supabase is configured (an empty table is an empty list). */
export async function listRules(): Promise<AutomationRule[]> {
  const db = getServiceSupabase();
  if (db) {
    const rows = await must(
      db.from("automation_rules").select("*").order("created_at", { ascending: true }),
      "select automation_rules",
    );
    return (rows ?? []).map(ruleFromRow);
  }
  return memoryRules();
}

export async function createRule(
  rule: Pick<
    AutomationRule,
    "name" | "triggerType" | "triggerConfig" | "actionType" | "actionConfig"
  >,
): Promise<AutomationRule> {
  const db = getServiceSupabase();
  let created: AutomationRule;
  if (db) {
    const row = await must(
      db
        .from("automation_rules")
        .insert({
          name: rule.name,
          trigger_type: rule.triggerType,
          trigger_config: rule.triggerConfig,
          action_type: rule.actionType,
          action_config: rule.actionConfig,
        })
        .select()
        .single(),
      "insert automation_rules",
    );
    created = ruleFromRow(row as unknown as Record<string, unknown>);
  } else {
    created = { ...rule, id: randomUUID(), enabled: true, lastFiredAt: null, fireCount: 0 };
    memoryRules().push(created);
  }
  await pushEvent({
    actor: "operator",
    eventType: "rule.created",
    subjectType: "rule",
    subjectId: created.id,
    detail: { name: created.name, trigger: created.triggerType, action: created.actionType },
  });
  return created;
}

/** Returns false when no rule with `id` exists (callers may 404). */
export async function setRuleEnabled(id: string, enabled: boolean): Promise<boolean> {
  const db = getServiceSupabase();
  let found: boolean;
  if (db) {
    const rows = await must(
      db.from("automation_rules").update({ enabled }).eq("id", id).select("id"),
      "update automation_rules.enabled",
    );
    found = (rows ?? []).length > 0;
  } else {
    const rule = memoryRules().find((r) => r.id === id);
    if (rule) rule.enabled = enabled;
    found = Boolean(rule);
  }
  if (!found) return false;
  await pushEvent({
    actor: "operator",
    eventType: enabled ? "rule.enabled" : "rule.disabled",
    subjectType: "rule",
    subjectId: id,
    detail: {},
  });
  return true;
}

/** Bump fire_count / last_fired_at on the rule (mutates the passed object too). */
export async function recordRuleFired(rule: AutomationRule): Promise<void> {
  rule.fireCount += 1;
  rule.lastFiredAt = new Date().toISOString();
  const db = getServiceSupabase();
  if (db) {
    await must(
      db
        .from("automation_rules")
        .update({ fire_count: rule.fireCount, last_fired_at: rule.lastFiredAt })
        .eq("id", rule.id),
      "update automation_rules.fire_count",
    );
  } else {
    const mem = memoryRules().find((r) => r.id === rule.id);
    if (mem && mem !== rule) {
      mem.fireCount = rule.fireCount;
      mem.lastFiredAt = rule.lastFiredAt;
    }
  }
}

// ---------------------------------------------------------------------------
// Rule evaluation — trigger -> condition -> action
// ---------------------------------------------------------------------------
export interface EvaluationResult {
  /** Enabled rules bound to this trigger. */
  matched: number;
  /** Names of the rules whose condition held and whose action ran. */
  fired: string[];
}

export async function evaluateRules(
  trigger: TriggerType,
  payload: Record<string, unknown>,
): Promise<EvaluationResult> {
  const { candidates, firing } = selectFiringRules(await listRules(), trigger, payload);
  // Webhooks go through the SSRF-safe, signed, timeout-bounded poster
  // (assertSafeWebhookUrl runs inside safePostJson before every request).
  const deps: ActionDeps = { db: getServiceSupabase(), postJson: safePostJson };
  const fired: string[] = [];

  for (const rule of firing) {
    const result = await executeAction(rule, payload, deps);
    fired.push(rule.name);
    await recordRuleFired(rule);
    await pushEvent({
      actor: `rule:${rule.id}`,
      eventType: "rule.fired",
      subjectType: "rule",
      subjectId: rule.id,
      detail: { name: rule.name, trigger, payload, ok: result.ok },
    });
    if (result.eventType) {
      await pushEvent({
        actor: `rule:${rule.id}`,
        eventType: result.eventType,
        subjectType: rule.actionType === "flag_property" ? "property" : "rule",
        subjectId:
          rule.actionType === "flag_property" && typeof payload.property_id === "string"
            ? payload.property_id
            : rule.id,
        detail: { rule: rule.name, ...result.detail },
      });
    }
  }
  return { matched: candidates.length, fired };
}
