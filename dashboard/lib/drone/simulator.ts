import type { Mission, Telemetry } from "../ops-types";
import type { DroneAdapter } from "./adapter";

/** Flight-model tunables (exported so tests can reason about tick counts). */
export const SIM_CONSTANTS = {
  /** Launch point (staging lot), [lat, lng]. */
  HOME: [35.2312, -80.848] as [number, number],
  CRUISE_MPS: 12,
  MAPPING_MPS: 8,
  ALT_M: 90,
  ROW_SPACING_M: 40,
  TICK_MS: 1000,
  /** Refuse routes longer than this many serpentine rows (~20 km of latitude). */
  MAX_ROWS: 500,
  /** Battery level at which the aircraft abandons mapping and returns home. */
  RTB_BATTERY_PCT: 20,
  M_PER_DEG_LAT: 111_320,
} as const;

const { HOME, CRUISE_MPS, MAPPING_MPS, ALT_M, ROW_SPACING_M, TICK_MS, MAX_ROWS, M_PER_DEG_LAT } =
  SIM_CONSTANTS;
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/**
 * Serpentine (lawnmower) waypoints across the polygon's bounding box.
 *
 * Rows are indexed with an integer loop (no float accumulator, which could
 * never terminate for huge coordinates) and bounded by MAX_ROWS.
 * @throws RangeError for empty polygons, non-finite coordinates, or a
 *         latitude span that needs more than MAX_ROWS rows.
 */
export function gridWaypoints(polygon: [number, number][]): [number, number][] {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    throw new RangeError("polygon must contain at least one [lat, lng] point");
  }
  for (const p of polygon) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new RangeError("polygon coordinates must be finite numbers");
    }
  }
  const lats = polygon.map((p) => p[0]);
  const lngs = polygon.map((p) => p[1]);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];

  const rowStep = ROW_SPACING_M / M_PER_DEG_LAT;
  const rows = Math.ceil((maxLat - minLat) / rowStep);
  if (!Number.isFinite(rows) || rows > MAX_ROWS) {
    throw new RangeError(`polygon spans too many rows (${rows} > ${MAX_ROWS})`);
  }

  const wps: [number, number][] = [];
  const count = Math.max(1, rows);
  for (let i = 0; i < count; i += 1) {
    const lat = Math.min(minLat + i * rowStep, maxLat);
    const leftToRight = i % 2 === 0;
    wps.push(leftToRight ? [lat, minLng] : [lat, maxLng]);
    wps.push(leftToRight ? [lat, maxLng] : [lat, minLng]);
  }
  return wps;
}

export interface SimulatorOptions {
  /** Start the 1 Hz ticker in the constructor (default true). Tests pass false and call tick(). */
  autoStart?: boolean;
}

/**
 * In-process flight model implementing DroneAdapter. Runs a 1 Hz tick that
 * advances the aircraft along its route, drains battery, and jitters link
 * quality, so the ops console behaves exactly as it will against a real
 * Cloud API-connected aircraft.
 */
export class SimulatorAdapter implements DroneAdapter {
  readonly serial = "SIM-1581F5";
  readonly model = "Mavic 3E (simulated)";

  private t: Telemetry = {
    serial: this.serial,
    model: this.model,
    state: "idle",
    lat: HOME[0],
    lng: HOME[1],
    altM: 0,
    headingDeg: 0,
    speedMps: 0,
    batteryPct: 100,
    satellites: 18,
    linkQuality: 98,
    missionId: null,
    missionProgress: 0,
    ts: new Date().toISOString(),
  };

  private route: [number, number][] = [];
  private wpIndex = 0;
  private onMissionComplete: ((missionId: string) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private faultLogged = false;

  constructor(onMissionComplete?: (missionId: string) => void, options: SimulatorOptions = {}) {
    this.onMissionComplete = onMissionComplete ?? null;
    if (options.autoStart ?? true) this.start();
  }

  /** Begin the 1 Hz ticker (idempotent). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  telemetry(): Telemetry {
    return { ...this.t };
  }

  async launchMission(mission: Mission): Promise<void> {
    const route = gridWaypoints(mission.polygon);
    if (route.length === 0) throw new RangeError("mission route is empty");
    this.route = route;
    this.wpIndex = 0;
    this.t.missionId = mission.id;
    this.t.missionProgress = 0;
    this.t.state = "enroute";
  }

  async abortMission(): Promise<void> {
    if (this.t.state === "enroute" || this.t.state === "mapping") {
      this.t.state = "rtb";
    }
  }

  /** Advance the flight model by one tick. Any internal fault sends the aircraft home. */
  tick(): void {
    try {
      this.step();
    } catch (err) {
      if (!this.faultLogged) {
        this.faultLogged = true;
        console.error("[hawkeye] simulator tick failed; returning to base", err);
      }
      this.t.state = "rtb";
      this.t.missionProgress = 0;
    }
  }

  private step(): void {
    const t = this.t;
    t.ts = new Date().toISOString();
    t.satellites = 16 + Math.floor(Math.random() * 5);
    t.linkQuality = Math.max(70, Math.min(100, t.linkQuality + (Math.random() - 0.5) * 6));

    switch (t.state) {
      case "idle":
        t.speedMps = 0;
        t.altM = 0;
        t.batteryPct = Math.min(100, t.batteryPct + 0.4); // charging on pad
        return;
      case "enroute": {
        t.altM = ALT_M;
        const first = this.route[0];
        if (!first) throw new Error("no route");
        const arrived = this.stepToward(first, CRUISE_MPS);
        if (arrived) t.state = "mapping";
        return;
      }
      case "mapping": {
        t.batteryPct = Math.max(0, t.batteryPct - 0.06);
        const target = this.route[this.wpIndex];
        if (!target) throw new Error("waypoint index out of range");
        const arrived = this.stepToward(target, MAPPING_MPS);
        if (arrived) this.wpIndex += 1;
        t.missionProgress = Math.min(100, (this.wpIndex / this.route.length) * 100);
        if (this.wpIndex >= this.route.length || t.batteryPct < SIM_CONSTANTS.RTB_BATTERY_PCT) {
          t.state = "rtb";
        }
        return;
      }
      case "rtb": {
        const arrived = this.stepToward(HOME, CRUISE_MPS);
        if (arrived) {
          const finished = t.missionProgress >= 99.9;
          const missionId = t.missionId;
          t.state = "idle";
          t.missionId = null;
          t.missionProgress = 0;
          t.altM = 0;
          if (missionId && this.onMissionComplete && finished) {
            this.onMissionComplete(missionId);
          }
        }
        return;
      }
      default:
        return;
    }
  }

  /** Move toward [lat,lng] at speed; returns true when within one tick's step. */
  private stepToward(target: [number, number], mps: number): boolean {
    const t = this.t;
    const dLatM = (target[0] - t.lat) * M_PER_DEG_LAT;
    const dLngM = (target[1] - t.lng) * mPerDegLng(t.lat);
    const dist = Math.hypot(dLatM, dLngM);
    t.headingDeg = ((Math.atan2(dLngM, dLatM) * 180) / Math.PI + 360) % 360;
    const step = (mps * TICK_MS) / 1000;
    t.speedMps = mps;
    t.batteryPct = Math.max(0, t.batteryPct - 0.03);
    if (dist <= step) {
      t.lat = target[0];
      t.lng = target[1];
      return true;
    }
    t.lat += ((dLatM / dist) * step) / M_PER_DEG_LAT;
    t.lng += ((dLngM / dist) * step) / mPerDegLng(t.lat);
    return false;
  }
}
