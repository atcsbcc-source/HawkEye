/**
 * Pure CRM helpers — no server, network or Supabase imports so both the
 * server pages and the client panels can share them.
 */
import { CRM_STAGES, STAGE_LABEL, type CrmStage, type PropertyLead } from "./types";

const STAGE_INDEX: Record<CrmStage, number> = Object.fromEntries(
  CRM_STAGES.map((s, i) => [s, i]),
) as Record<CrmStage, number>;

/** Stages an operator advances through in order (terminal stages excluded). */
export const ACTIVE_STAGES: CrmStage[] = CRM_STAGES.filter((s) => !isClosedStage(s));

export function isClosedStage(stage: CrmStage): boolean {
  return stage === "closed_won" || stage === "closed_lost";
}

export function stageIndex(stage: CrmStage): number {
  return STAGE_INDEX[stage] ?? 0;
}

/** The stage after `stage` on the happy path, or null at the end. */
export function nextStage(stage: CrmStage): CrmStage | null {
  if (isClosedStage(stage)) return null;
  const i = stageIndex(stage);
  return ACTIVE_STAGES[i + 1] ?? "closed_won";
}

export function previousStage(stage: CrmStage): CrmStage | null {
  if (isClosedStage(stage)) return ACTIVE_STAGES[ACTIVE_STAGES.length - 1];
  const i = stageIndex(stage);
  return i > 0 ? ACTIVE_STAGES[i - 1] : null;
}

// ---------------------------------------------------------------------------
// Work queue — open tasks and next actions across every parcel, bucketed
// ---------------------------------------------------------------------------
export type DueBucket = "overdue" | "today" | "week" | "later" | "unscheduled";

export const BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "This week",
  later: "Later",
  unscheduled: "No date",
};

export const BUCKET_ORDER: DueBucket[] = ["overdue", "today", "week", "later", "unscheduled"];

const DAY_MS = 86_400_000;

/** Local-day bucket for a due timestamp. `now` keeps renders deterministic. */
export function dueBucket(dueAt: string | null | undefined, now = Date.now()): DueBucket {
  if (!dueAt) return "unscheduled";
  const t = Date.parse(dueAt);
  if (!Number.isFinite(t)) return "unscheduled";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = startOfToday.getTime() + DAY_MS;
  if (t < startOfToday.getTime()) return "overdue";
  if (t < endOfToday) return "today";
  if (t < endOfToday + 6 * DAY_MS) return "week";
  return "later";
}

export interface WorkItem {
  /** `task` = an open activity of kind task; `next_action` = properties.next_action. */
  kind: "task" | "next_action";
  /** Activity id for tasks, property id for next actions. */
  id: string;
  propertyId: string;
  address: string;
  parcelId: string;
  stage: CrmStage;
  title: string;
  dueAt: string | null;
  bucket: DueBucket;
  assignedTo: string | null;
  priority: PropertyLead["priority"];
}

export interface OpenTaskLike {
  id: string;
  property_id: string;
  body: string;
  due_at: string | null;
}

/**
 * Merge open tasks with each parcel's next action into one list, sorted by
 * bucket (overdue first) then due date. Tasks on unknown / archived parcels
 * are dropped (the lead list is the visibility authority).
 */
export function buildWorkQueue(
  leads: PropertyLead[],
  tasks: OpenTaskLike[],
  now = Date.now(),
): WorkItem[] {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const items: WorkItem[] = [];
  for (const t of tasks) {
    const lead = byId.get(t.property_id);
    if (!lead) continue;
    items.push({
      kind: "task",
      id: t.id,
      propertyId: lead.id,
      address: lead.address,
      parcelId: lead.parcel_id,
      stage: lead.crm_stage,
      title: t.body,
      dueAt: t.due_at,
      bucket: dueBucket(t.due_at, now),
      assignedTo: lead.assigned_to ?? null,
      priority: lead.priority,
    });
  }
  for (const lead of leads) {
    if (!lead.next_action) continue;
    items.push({
      kind: "next_action",
      id: lead.id,
      propertyId: lead.id,
      address: lead.address,
      parcelId: lead.parcel_id,
      stage: lead.crm_stage,
      title: lead.next_action,
      dueAt: lead.next_action_at ?? null,
      bucket: dueBucket(lead.next_action_at, now),
      assignedTo: lead.assigned_to ?? null,
      priority: lead.priority,
    });
  }
  const rank = (b: DueBucket) => BUCKET_ORDER.indexOf(b);
  return items.sort((a, b) => {
    const r = rank(a.bucket) - rank(b.bucket);
    if (r !== 0) return r;
    const ta = a.dueAt ? Date.parse(a.dueAt) : Infinity;
    const tb = b.dueAt ? Date.parse(b.dueAt) : Infinity;
    if (ta !== tb) return ta - tb;
    return a.address.localeCompare(b.address);
  });
}

// ---------------------------------------------------------------------------
// Deal math
// ---------------------------------------------------------------------------
/** Maximum allowable offer at the classic 70 % rule: ARV × 0.7 − repairs. */
export function maxAllowableOffer(
  arv: number | null | undefined,
  repairs: number | null | undefined,
  ratio = 0.7,
): number | null {
  if (arv == null || !Number.isFinite(arv) || arv <= 0) return null;
  const r = repairs != null && Number.isFinite(repairs) ? repairs : 0;
  return Math.max(0, Math.round(arv * ratio - r));
}

/** `$125,000` — compact, no cents. */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export function stageLabel(stage: CrmStage): string {
  return STAGE_LABEL[stage] ?? stage;
}
