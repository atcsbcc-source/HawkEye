import { SimulatorAdapter } from "../drone/simulator";
import type { DroneAdapter } from "../drone/adapter";
import type { AuditEvent, AutomationRule, Mission } from "../ops-types";

/**
 * Server-side ops state. The drone adapter and mission queue are in-process
 * (they front live hardware, not durable business data); automation rules and
 * audit events live in Supabase when configured and otherwise in memory so the
 * console is fully operable out of the box.
 *
 * Kept on globalThis to survive dev-server hot reloads.
 */
export interface OpsState {
  adapter: DroneAdapter;
  missions: Mission[];
  /** Mock-mode rule store; unused when Supabase is configured. */
  rules: AutomationRule[];
  /** Mock-mode audit store (also a hot cache in DB mode). */
  events: AuditEvent[];
  /** Set synchronously while an adapter launch is in flight (closes the launch TOCTOU). */
  launching: boolean;
  /** Registered by lib/server/missions.ts; invoked by the adapter on mission completion. */
  onMissionComplete: ((missionId: string) => void) | null;
}

/** Build the aircraft backend. Swap in DjiCloudAdapter here when a bridge exists. */
export function createAdapter(onMissionComplete: (missionId: string) => void): DroneAdapter {
  return new SimulatorAdapter(onMissionComplete);
}

const g = globalThis as unknown as { __hawkeyeOps?: OpsState };

function initState(): OpsState {
  const state: OpsState = {
    adapter: createAdapter((missionId) => g.__hawkeyeOps?.onMissionComplete?.(missionId)),
    missions: [],
    rules: [],
    events: [],
    launching: false,
    onMissionComplete: null,
  };
  return state;
}

export function getOpsState(): OpsState {
  if (!g.__hawkeyeOps) g.__hawkeyeOps = initState();
  return g.__hawkeyeOps;
}

/** Test hook: drop the singleton so the next access rebuilds it. */
export function resetOpsState(): void {
  const adapter = g.__hawkeyeOps?.adapter;
  if (adapter instanceof SimulatorAdapter) adapter.stop();
  g.__hawkeyeOps = undefined;
}
