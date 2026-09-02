import { randomUUID } from "crypto";
import { getServiceSupabase } from "../supabase";
import { AUTO_FLAG_CONFIDENCE, DISTRESS_THRESHOLD_DAYS } from "../constants";
import type { AutomationRule, TriggerType } from "../ops-types";
import { selectFiringRules } from "../automation/evaluate";
import { executeAction, type ActionDeps } from "../automation/actions";
import { postJson as safePostJson } from "./safe-fetch";
import { pushEvent } from "./audit";
import { must } from "./db";
import { mockCreateTaskForRule, mockFlagProperty, mockSetStageForRule } from "./mock-store";
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
  verifiedStage: "00000000-0000-4000-8000-000000000003",
  verifiedTask: "00000000-0000-4000-8000-000000000004",
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
  // Workflow defaults (20260904000000_crm.sql seeds the same two, enabled).
  {
    id: DEFAULT_RULE_IDS.verifiedStage,
    name: "Verified vacant → Verified stage",
    triggerType: "verdict_recorded",
    triggerConfig: { verdict: "verified_vacant" },
    actionType: "set_stage",
    actionConfig: { stage: "verified" },
    enabled: true,
    lastFiredAt: null,
    fireCount: 0,
  },
  {
    id: DEFAULT_RULE_IDS.verifiedTask,
    name: "Verified vacant → open skip-trace task",
    triggerType: "verdict_recorded",
    triggerConfig: { verdict: "verified_vacant" },
    actionType: "create_task",
    actionConfig: { title: "Skip-trace the owner and add a contact", due_in_days: 3 },
    enabled: true,
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
export interface RuleOutcome {
  id: string;
  name: string;
  actionType: AutomationRule["actionType"];
  /** Whether the action succeeded (a webhook 2xx, a flag applied, a notify). */
  ok: boolean;
  /** ok but nothing changed (already flagged, unknown/snoozed parcel, below threshold). */
  skipped?: boolean;
  /** Failure reason for a failed action (webhook error, no URL, mock mode). */
  error?: string;
  /** Failure class from safe-fetch / the action (unconfigured|unsafe_url|timeout|network|http|mock_mode). */
  kind?: string;
}

export interface EvaluationResult {
  /** Enabled rules bound to this trigger. */
  matched: number;
  /** Names of the rules whose condition held and whose action actually applied a side effect. */
  fired: string[];
  /** Per-rule result for every rule whose condition held (ok, skipped and failed). */
  outcomes: RuleOutcome[];
}

/**
 * Mock mode never delivers a webhook: the seeded leads must not leave the
 * process even when CRM_WEBHOOK_URL (or a rule URL) is configured — the same
 * guard POST /api/dispatch applies with its 503.
 */
const mockModePostJson: ActionDeps["postJson"] = async () => {
  throw Object.assign(new Error("mock mode: webhooks are not delivered without Supabase"), {
    kind: "mock_mode",
  });
};

/** Actions whose side effect lands on the parcel in `payload.property_id`. */
const PROPERTY_ACTIONS: ReadonlySet<AutomationRule["actionType"]> = new Set([
  "flag_property",
  "set_stage",
  "create_task",
] as const);

export interface EvaluateOptions {
  /** Restrict evaluation to these rule ids (the sweep passes its pending set). */
  only?: readonly string[];
}

export async function evaluateRules(
  trigger: TriggerType,
  payload: Record<string, unknown>,
  opts: EvaluateOptions = {},
): Promise<EvaluationResult> {
  let rules = await listRules();
  if (opts.only) {
    const allowed = new Set(opts.only);
    rules = rules.filter((r) => allowed.has(r.id));
  }
  const { candidates, firing } = selectFiringRules(rules, trigger, payload);
  // Webhooks go through the SSRF-safe, signed, timeout-bounded poster
  // (assertSafeWebhookUrl runs inside safePostJson before every request).
  const db = getServiceSupabase();
  const deps: ActionDeps = {
    db,
    postJson: db ? safePostJson : mockModePostJson,
    flagWithoutDb: mockFlagProperty,
    setStageWithoutDb: mockSetStageForRule,
    createTaskWithoutDb: mockCreateTaskForRule,
  };
  const fired: string[] = [];
  const outcomes: RuleOutcome[] = [];

  for (const rule of firing) {
    const result = await executeAction(rule, payload, deps);
    const outcome: RuleOutcome = {
      id: rule.id,
      name: rule.name,
      actionType: rule.actionType,
      ok: result.ok,
    };
    if (result.skipped) outcome.skipped = true;
    if (!result.ok) {
      if (typeof result.detail.error === "string") outcome.error = result.detail.error;
      else if (typeof result.detail.status === "number")
        outcome.error = `webhook responded ${result.detail.status}`;
      if (typeof result.detail.kind === "string") outcome.kind = result.detail.kind;
    }
    outcomes.push(outcome);
    // A no-op (parcel already flagged, unknown, snoozed, below threshold) is
    // not a firing and leaves no audit trail: the counters only reflect real
    // transitions.
    if (result.skipped) continue;
    // A failed action (webhook 5xx, timeout, no URL) is not a firing either:
    // leave fire_count alone so the ledger and counters only reflect real deliveries.
    if (result.ok) {
      fired.push(rule.name);
      await recordRuleFired(rule);
    }
    await pushEvent({
      actor: `rule:${rule.id}`,
      eventType: "rule.fired",
      subjectType: "rule",
      subjectId: rule.id,
      detail: { name: rule.name, trigger, payload, ok: result.ok },
    });
    if (result.eventType) {
      const onProperty =
        PROPERTY_ACTIONS.has(rule.actionType) && typeof payload.property_id === "string";
      await pushEvent({
        actor: `rule:${rule.id}`,
        eventType: result.eventType,
        subjectType: onProperty ? "property" : "rule",
        subjectId: onProperty ? (payload.property_id as string) : rule.id,
        detail: { rule: rule.name, ...result.detail },
      });
    }
  }
  return { matched: candidates.length, fired, outcomes };
}
