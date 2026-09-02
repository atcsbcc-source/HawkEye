import { randomUUID } from "crypto";
import { getServiceSupabase } from "../supabase";
import { AUDIT_FEED_LIMIT, AUDIT_MEMORY_CAP } from "../constants";
import type { AuditEvent } from "../ops-types";
import { must } from "./db";
import { getOpsState } from "./state";

export type AuditInput = Omit<AuditEvent, "id" | "occurredAt"> & {
  /** Authenticated user behind `actor`; written to `actor_user_id` only when provided. */
  actorUserId?: string;
};

function eventFromRow(r: Record<string, unknown>): AuditEvent {
  return {
    id: String(r.id),
    occurredAt: String(r.occurred_at),
    actor: String(r.actor),
    eventType: String(r.event_type),
    subjectType: (r.subject_type as string | null) ?? null,
    subjectId: (r.subject_id as string | null) ?? null,
    detail: (r.detail as Record<string, unknown> | null) ?? {},
  };
}

/**
 * Append an audit event. Always recorded in memory synchronously (capped at
 * AUDIT_MEMORY_CAP); when Supabase is configured the insert is awaited and a
 * failure is logged — the promise never rejects, so `void pushEvent(...)` from
 * synchronous code is safe and `await pushEvent(...)` guarantees persistence.
 */
export async function pushEvent(e: AuditInput): Promise<void> {
  const { actorUserId, ...rest } = e;
  const event: AuditEvent = {
    ...rest,
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
  };
  const state = getOpsState();
  state.events.unshift(event);
  if (state.events.length > AUDIT_MEMORY_CAP) state.events.length = AUDIT_MEMORY_CAP;

  const db = getServiceSupabase();
  if (!db) return;
  const row: Record<string, unknown> = {
    actor: event.actor,
    event_type: event.eventType,
    subject_type: event.subjectType,
    subject_id: event.subjectId,
    detail: event.detail,
  };
  if (actorUserId) row.actor_user_id = actorUserId;
  try {
    await must(db.from("audit_events").insert(row), "insert audit_events");
  } catch (err) {
    console.error("[hawkeye] audit insert failed", event.eventType, err);
  }
}

/** Newest first. DB-exclusive when Supabase is configured; memory otherwise. */
export async function listEvents(limit = AUDIT_FEED_LIMIT): Promise<AuditEvent[]> {
  const db = getServiceSupabase();
  if (db) {
    const rows = await must(
      db.from("audit_events").select("*").order("occurred_at", { ascending: false }).limit(limit),
      "select audit_events",
    );
    return (rows ?? []).map(eventFromRow);
  }
  return getOpsState().events.slice(0, limit);
}
