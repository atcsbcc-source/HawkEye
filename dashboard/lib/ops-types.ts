/** Shared types for the operations & automation layer. */

export type DroneState = "offline" | "idle" | "enroute" | "mapping" | "rtb";

export interface Telemetry {
  serial: string;
  model: string;
  state: DroneState;
  lat: number;
  lng: number;
  altM: number;
  headingDeg: number;
  speedMps: number;
  batteryPct: number;
  satellites: number;
  linkQuality: number; // 0-100
  missionId: string | null;
  missionProgress: number; // 0-100
  ts: string;
}

export type MissionStatus = "queued" | "active" | "completed" | "aborted";

export interface Mission {
  id: string;
  name: string;
  /** [lat, lng] ring (unclosed) of the area of operations. */
  polygon: [number, number][];
  status: MissionStatus;
  droneSerial: string | null;
  progress: number;
  createdAt: string;
  launchedAt: string | null;
  completedAt: string | null;
}

export type TriggerType = "scan_processed" | "distress_threshold" | "mission_completed";
export type ActionType = "flag_property" | "dispatch_webhook" | "notify";

export interface AutomationRule {
  id: string;
  name: string;
  triggerType: TriggerType;
  /** scan_processed: {min_confidence}; distress_threshold: {min_days} */
  triggerConfig: Record<string, unknown>;
  actionType: ActionType;
  /** dispatch_webhook: {url} */
  actionConfig: Record<string, unknown>;
  enabled: boolean;
  lastFiredAt: string | null;
  fireCount: number;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: string;
  eventType: string;
  subjectType: string | null;
  subjectId: string | null;
  detail: Record<string, unknown>;
}

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  scan_processed: "Scan processed",
  distress_threshold: "Distress threshold crossed",
  mission_completed: "Mission completed",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  flag_property: "Flag property",
  dispatch_webhook: "Dispatch CRM webhook",
  notify: "Notify operators",
};
