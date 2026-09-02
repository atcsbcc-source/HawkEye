import type { Mission, Telemetry } from "../ops-types";
import type { DroneAdapter } from "./adapter";

const HOME: [number, number] = [35.2312, -80.848]; // launch point (staging lot)
const CRUISE_MPS = 12;
const MAPPING_MPS = 8;
const ALT_M = 90;
const ROW_SPACING_M = 40;
const TICK_MS = 1000;

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Serpentine (lawnmower) waypoints across the polygon's bounding box. */
function gridWaypoints(polygon: [number, number][]): [number, number][] {
  const lats = polygon.map((p) => p[0]);
  const lngs = polygon.map((p) => p[1]);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];

  const rowStep = ROW_SPACING_M / M_PER_DEG_LAT;
  const wps: [number, number][] = [];
  let leftToRight = true;
  for (let lat = minLat; lat <= maxLat + 1e-9; lat += rowStep) {
    wps.push(leftToRight ? [lat, minLng] : [lat, maxLng]);
    wps.push(leftToRight ? [lat, maxLng] : [lat, minLng]);
    leftToRight = !leftToRight;
  }
  return wps;
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

  constructor(onMissionComplete?: (missionId: string) => void) {
    this.onMissionComplete = onMissionComplete ?? null;
    setInterval(() => this.tick(), TICK_MS);
  }

  telemetry(): Telemetry {
    return { ...this.t };
  }

  async launchMission(mission: Mission): Promise<void> {
    this.route = gridWaypoints(mission.polygon);
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

  private tick(): void {
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
        const arrived = this.stepToward(this.route[0], CRUISE_MPS);
        if (arrived) t.state = "mapping";
        return;
      }
      case "mapping": {
        t.batteryPct = Math.max(0, t.batteryPct - 0.06);
        const target = this.route[this.wpIndex];
        const arrived = this.stepToward(target, MAPPING_MPS);
        if (arrived) this.wpIndex += 1;
        t.missionProgress = Math.min(100, (this.wpIndex / this.route.length) * 100);
        if (this.wpIndex >= this.route.length || t.batteryPct < 20) {
          t.state = "rtb";
        }
        return;
      }
      case "rtb": {
        const arrived = this.stepToward(HOME, CRUISE_MPS);
        if (arrived) {
          const finished = this.t.missionProgress >= 99.9;
          if (this.t.missionId && this.onMissionComplete && finished) {
            this.onMissionComplete(this.t.missionId);
          }
          t.state = "idle";
          t.missionId = null;
          t.missionProgress = 0;
          t.altM = 0;
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
    t.lat += (dLatM / dist) * step / M_PER_DEG_LAT;
    t.lng += (dLngM / dist) * step / mPerDegLng(t.lat);
    return false;
  }
}
