import { randomUUID } from "crypto";
import { getServiceSupabase } from "../supabase";
import { SimulatorAdapter } from "../drone/simulator";
import type { DroneAdapter } from "../drone/adapter";
import type {
  AuditEvent,
  AutomationRule,
  Mission,
  TriggerType,
} from "../ops-types";

/**
 * Server-side ops state. The drone adapter and mission queue are in-process
 * (they front live hardware, not durable business data); automation rules and
 * audit events write through to Supabase when configured and otherwise live in
 * memory so the console is fully operable out of the box.
 *
 * Kept on globalThis to survive dev-server hot reloads.
 */
interface OpsState {
  adapter: DroneAdapter;
  missions: Mission[];
  rules: AutomationRule[];
  events: AuditEvent[];
}

const DEFAULT_RULES: AutomationRule[] = [
  {
    id: "rule-default-flag",
    name: "Auto-flag high-confidence vacancies",
    triggerType: "scan_processed",
    triggerConfig: { min_confidence: 75 },
    actionType: "flag_property",
    actionConfig: {},
    enabled: true,
    lastFiredAt: null,
    fireCount: 0,
  },
  {
    id: "rule-default-dispatch",
    name: "Dispatch 60-day distressed leads to CRM",
    triggerType: "distress_threshold",
    triggerConfig: { min_days: 60 },
    actionType: "dispatch_webhook",
    actionConfig: {},
    enabled: false,
    lastFiredAt: null,
    fireCount: 0,
  },
];

function initState(): OpsState {
  const state: OpsState = {
    adapter: undefined as unknown as DroneAdapter,
    missions: [],
    rules: structuredClone(DEFAULT_RULES),
    events: [],
  };
  state.adapter = new SimulatorAdapter((missionId) => {
    const m = state.missions.find((x) => x.id === missionId);
    if (m) {
      m.status = "completed";
      m.progress = 100;
      m.completedAt = new Date().toISOString();
    }
    pushEvent({
      actor: "system",
      eventType: "mission.completed",
      subjectType: "mission",
      subjectId: missionId,
      detail: { name: m?.name },
    });
    void evaluateRules("mission_completed", { missionId, name: m?.name });
  });
  return state;
}

const g = globalThis as unknown as { __hawkeyeOps?: OpsState };
function ops(): OpsState {
  if (!g.__hawkeyeOps) g.__hawkeyeOps = initState();
  return g.__hawkeyeOps;
}

// ---------------------------------------------------------------------------
// Drone
// ---------------------------------------------------------------------------
export function getAdapter(): DroneAdapter {
  return ops().adapter;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------
export function listMissions(): Mission[] {
  return [...ops().missions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createMission(name: string, polygon: [number, number][]): Mission {
  const mission: Mission = {
    id: randomUUID(),
    name,
    polygon,
    status: "queued",
    droneSerial: null,
    progress: 0,
    createdAt: new Date().toISOString(),
    launchedAt: null,
    completedAt: null,
  };
  ops().missions.push(mission);
  pushEvent({
    actor: "operator",
    eventType: "mission.created",
    subjectType: "mission",
    subjectId: mission.id,
    detail: { name },
  });
  return mission;
}

export async function launchMission(id: string): Promise<Mission | null> {
  const state = ops();
  if (state.missions.some((m) => m.status === "active")) return null;
  const mission = state.missions.find((m) => m.id === id && m.status === "queued");
  if (!mission) return null;
  await state.adapter.launchMission(mission);
  mission.status = "active";
  mission.droneSerial = state.adapter.serial;
  mission.launchedAt = new Date().toISOString();
  pushEvent({
    actor: "operator",
    eventType: "mission.launched",
    subjectType: "mission",
    subjectId: id,
    detail: { name: mission.name, drone: state.adapter.serial },
  });
  return mission;
}

export async function abortMission(id: string): Promise<Mission | null> {
  const state = ops();
  const mission = state.missions.find((m) => m.id === id && m.status === "active");
  if (!mission) return null;
  await state.adapter.abortMission();
  mission.status = "aborted";
  mission.completedAt = new Date().toISOString();
  pushEvent({
    actor: "operator",
    eventType: "mission.aborted",
    subjectType: "mission",
    subjectId: id,
    detail: { name: mission.name },
  });
  return mission;
}

/** Reflect live adapter progress onto the active mission row. */
export function syncMissionProgress(): void {
  const state = ops();
  const t = state.adapter.telemetry();
  const active = state.missions.find((m) => m.status === "active");
  if (active && t.missionId === active.id) active.progress = t.missionProgress;
}

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------
export function pushEvent(e: Omit<AuditEvent, "id" | "occurredAt">): void {
  const event: AuditEvent = {
    ...e,
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
  };
  const state = ops();
  state.events.unshift(event);
  if (state.events.length > 500) state.events.pop();

  const db = getServiceSupabase();
  if (db) {
    void db.from("audit_events").insert({
      actor: event.actor,
      event_type: event.eventType,
      subject_type: event.subjectType,
      subject_id: event.subjectId,
      detail: event.detail,
    });
  }
}

export async function listEvents(limit = 50): Promise<AuditEvent[]> {
  const db = getServiceSupabase();
  if (db) {
    const { data } = await db
      .from("audit_events")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (data && data.length > 0) {
      return data.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        actor: r.actor,
        eventType: r.event_type,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        detail: r.detail ?? {},
      }));
    }
  }
  return ops().events.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Automation rules
// ---------------------------------------------------------------------------
function ruleFromRow(r: Record<string, any>): AutomationRule {
  return {
    id: r.id,
    name: r.name,
    triggerType: r.trigger_type,
    triggerConfig: r.trigger_config ?? {},
    actionType: r.action_type,
    actionConfig: r.action_config ?? {},
    enabled: r.enabled,
    lastFiredAt: r.last_fired_at,
    fireCount: r.fire_count ?? 0,
  };
}

export async function listRules(): Promise<AutomationRule[]> {
  const db = getServiceSupabase();
  if (db) {
    const { data } = await db
      .from("automation_rules")
      .select("*")
      .order("created_at", { ascending: true });
    if (data && data.length > 0) return data.map(ruleFromRow);
  }
  return ops().rules;
}

export async function createRule(
  rule: Pick<AutomationRule, "name" | "triggerType" | "triggerConfig" | "actionType" | "actionConfig">
): Promise<AutomationRule> {
  const db = getServiceSupabase();
  if (db) {
    const { data, error } = await db
      .from("automation_rules")
      .insert({
        name: rule.name,
        trigger_type: rule.triggerType,
        trigger_config: rule.triggerConfig,
        action_type: rule.actionType,
        action_config: rule.actionConfig,
      })
      .select()
      .single();
    if (!error && data) return ruleFromRow(data);
  }
  const created: AutomationRule = {
    ...rule,
    id: randomUUID(),
    enabled: true,
    lastFiredAt: null,
    fireCount: 0,
  };
  ops().rules.push(created);
  pushEvent({
    actor: "operator",
    eventType: "rule.created",
    subjectType: "rule",
    subjectId: created.id,
    detail: { name: created.name },
  });
  return created;
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const db = getServiceSupabase();
  if (db) {
    await db.from("automation_rules").update({ enabled }).eq("id", id);
  }
  const rule = ops().rules.find((r) => r.id === id);
  if (rule) rule.enabled = enabled;
  pushEvent({
    actor: "operator",
    eventType: enabled ? "rule.enabled" : "rule.disabled",
    subjectType: "rule",
    subjectId: id,
    detail: {},
  });
}

// ---------------------------------------------------------------------------
// Rule evaluation — trigger -> condition -> action
// ---------------------------------------------------------------------------
export interface EvaluationResult {
  matched: number;
  fired: string[];
}

export async function evaluateRules(
  trigger: TriggerType,
  payload: Record<string, unknown>
): Promise<EvaluationResult> {
  const rules = (await listRules()).filter(
    (r) => r.enabled && r.triggerType === trigger
  );
  const fired: string[] = [];

  for (const rule of rules) {
    if (!conditionMet(rule, payload)) continue;
    await executeAction(rule, payload);
    fired.push(rule.name);

    rule.fireCount += 1;
    rule.lastFiredAt = new Date().toISOString();
    const db = getServiceSupabase();
    if (db) {
      await db
        .from("automation_rules")
        .update({ fire_count: rule.fireCount, last_fired_at: rule.lastFiredAt })
        .eq("id", rule.id);
    }
    pushEvent({
      actor: `rule:${rule.id}`,
      eventType: "rule.fired",
      subjectType: "rule",
      subjectId: rule.id,
      detail: { name: rule.name, trigger, payload },
    });
  }
  return { matched: rules.length, fired };
}

function conditionMet(rule: AutomationRule, payload: Record<string, unknown>): boolean {
  switch (rule.triggerType) {
    case "scan_processed": {
      const min = Number(rule.triggerConfig.min_confidence ?? 75);
      return Number(payload.vacancy_confidence ?? 0) >= min;
    }
    case "distress_threshold": {
      const minDays = Number(rule.triggerConfig.min_days ?? 60);
      return Number(payload.days_distressed ?? 0) >= minDays;
    }
    case "mission_completed":
      return true;
  }
}

async function executeAction(
  rule: AutomationRule,
  payload: Record<string, unknown>
): Promise<void> {
  const db = getServiceSupabase();
  switch (rule.actionType) {
    case "flag_property": {
      if (db && payload.property_id) {
        await db
          .from("properties")
          .update({ status: "flagged" })
          .eq("id", payload.property_id)
          .neq("status", "dispatched");
      }
      return;
    }
    case "dispatch_webhook": {
      const url = String(rule.actionConfig.url ?? process.env.CRM_WEBHOOK_URL ?? "");
      if (url) {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "hawkeye-automation", rule: rule.name, payload }),
        }).catch(() => undefined);
      }
      return;
    }
    case "notify": {
      // Audit event doubles as the notification channel until email/Slack is wired.
      return;
    }
  }
}
