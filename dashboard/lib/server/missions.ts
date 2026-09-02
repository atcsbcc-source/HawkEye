import { randomUUID } from "crypto";
import type { DroneAdapter } from "../drone/adapter";
import type { Mission } from "../ops-types";
import { pushEvent } from "./audit";
import { evaluateRules } from "./rules";
import { getOpsState } from "./state";

/** Missions retained in memory (oldest finished ones are dropped past this). */
export const MISSION_KEEP_CAP = 200;
/** Maximum queued (not yet launched) missions. */
export const MISSION_QUEUE_CAP = 20;

/** Thrown by createMission when the queue is full; routes map it to 409/429. */
export class MissionQueueFullError extends Error {
  constructor() {
    super(`Mission queue is full (${MISSION_QUEUE_CAP} queued)`);
    this.name = "MissionQueueFullError";
  }
}

function completeMission(missionId: string): void {
  const state = getOpsState();
  const m = state.missions.find((x) => x.id === missionId);
  if (m) {
    m.status = "completed";
    m.progress = 100;
    m.completedAt = new Date().toISOString();
  }
  void pushEvent({
    actor: "system",
    eventType: "mission.completed",
    subjectType: "mission",
    subjectId: missionId,
    detail: { name: m?.name },
  });
  evaluateRules("mission_completed", { missionId, name: m?.name }).catch((err) =>
    console.error("[hawkeye] mission_completed evaluation failed", err),
  );
}

/** Wire the adapter's completion callback to the mission store (idempotent). */
function ensureWired(): ReturnType<typeof getOpsState> {
  const state = getOpsState();
  if (state.onMissionComplete !== completeMission) state.onMissionComplete = completeMission;
  return state;
}

// ---------------------------------------------------------------------------
// Drone
// ---------------------------------------------------------------------------
export function getAdapter(): DroneAdapter {
  return ensureWired().adapter;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------
export function listMissions(): Mission[] {
  return [...ensureWired().missions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Drop the oldest finished missions so the in-process list stays bounded. */
function pruneMissions(missions: Mission[]): void {
  if (missions.length <= MISSION_KEEP_CAP) return;
  const finished = missions
    .filter((m) => m.status === "completed" || m.status === "aborted")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const m of finished) {
    if (missions.length <= MISSION_KEEP_CAP) break;
    missions.splice(missions.indexOf(m), 1);
  }
}

export function createMission(name: string, polygon: [number, number][]): Mission {
  const state = ensureWired();
  if (state.missions.filter((m) => m.status === "queued").length >= MISSION_QUEUE_CAP) {
    throw new MissionQueueFullError();
  }
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
  state.missions.push(mission);
  pruneMissions(state.missions);
  void pushEvent({
    actor: "operator",
    eventType: "mission.created",
    subjectType: "mission",
    subjectId: mission.id,
    detail: { name },
  });
  return mission;
}

/**
 * Launch a queued mission. Returns null on a state conflict (another mission
 * active or launching, or the id is not queued). Adapter failures THROW so the
 * route can answer 502 — the mission stays queued.
 */
export async function launchMission(id: string): Promise<Mission | null> {
  const state = ensureWired();
  if (state.launching || state.missions.some((m) => m.status === "active")) return null;
  const mission = state.missions.find((m) => m.id === id && m.status === "queued");
  if (!mission) return null;

  state.launching = true;
  try {
    await state.adapter.launchMission(mission);
  } finally {
    state.launching = false;
  }
  mission.status = "active";
  mission.droneSerial = state.adapter.serial;
  mission.launchedAt = new Date().toISOString();
  await pushEvent({
    actor: "operator",
    eventType: "mission.launched",
    subjectType: "mission",
    subjectId: id,
    detail: { name: mission.name, drone: state.adapter.serial },
  });
  return mission;
}

export async function abortMission(id: string): Promise<Mission | null> {
  const state = ensureWired();
  const mission = state.missions.find((m) => m.id === id && m.status === "active");
  if (!mission) return null;
  await state.adapter.abortMission();
  mission.status = "aborted";
  mission.completedAt = new Date().toISOString();
  await pushEvent({
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
  const state = ensureWired();
  const t = state.adapter.telemetry();
  const active = state.missions.find((m) => m.status === "active");
  if (active && t.missionId === active.id) active.progress = t.missionProgress;
}
