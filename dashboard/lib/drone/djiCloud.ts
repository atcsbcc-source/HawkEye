import type { Mission, Telemetry } from "../ops-types";
import type { DroneAdapter } from "./adapter";

/**
 * DJI Cloud API adapter — the integration path for SDK/enterprise aircraft
 * (Mavic 3E/3T, Matrice 30/300/350, DJI Dock).
 *
 * Architecture (see https://developer.dji.com/doc/cloud-api-tutorial/en/):
 *   1. Run an MQTT broker (EMQX/Mosquitto) reachable by the aircraft's remote
 *      controller or Dock. DJI Pilot 2 -> Cloud Service -> enter your broker.
 *   2. The device publishes telemetry on `thing/product/{device_sn}/osd`
 *      (~2 Hz: position, attitude, battery, link) and state on `.../state`.
 *   3. Wayline (mapping) missions are KMZ files: upload to object storage,
 *      then publish a `flighttask_prepare` + `flighttask_execute` service
 *      call on `thing/product/{gateway_sn}/services`.
 *   4. Subscribe to `thing/product/{gateway_sn}/events` for mission progress,
 *      media upload notifications, and HMS health alerts.
 *
 * This class holds the last OSD snapshot pushed by a bridge process that
 * subscribes to those topics (an MQTT client doesn't belong inside a Next.js
 * request handler — run it as a worker and feed snapshots in, or poll your
 * bridge's REST endpoint here).
 */
export class DjiCloudAdapter implements DroneAdapter {
  constructor(
    readonly serial: string,
    readonly model: string = "Mavic 3E",
  ) {}

  private last: Telemetry | null = null;

  /** Called by your MQTT bridge worker with each parsed OSD message. */
  ingestOsd(osd: Telemetry): void {
    this.last = osd;
  }

  telemetry(): Telemetry {
    if (this.last) return this.last;
    return {
      serial: this.serial,
      model: this.model,
      state: "offline",
      lat: 0,
      lng: 0,
      altM: 0,
      headingDeg: 0,
      speedMps: 0,
      batteryPct: 0,
      satellites: 0,
      linkQuality: 0,
      missionId: null,
      missionProgress: 0,
      ts: new Date(0).toISOString(),
    };
  }

  async launchMission(_mission: Mission): Promise<void> {
    // TODO: generate a wayline KMZ from mission.polygon (grid at your GSD),
    // upload it, then publish flighttask_prepare/flighttask_execute via the
    // MQTT bridge. Template: https://developer.dji.com/doc/cloud-api-tutorial/en/feature-set/dock-feature-set/wayline-task.html
    throw new Error(
      "DJI Cloud API bridge not configured — set up an MQTT broker first (see class docs).",
    );
  }

  async abortMission(): Promise<void> {
    // TODO: publish `flighttask_stop` service call via the MQTT bridge.
    throw new Error(
      "DJI Cloud API bridge not configured — set up an MQTT broker first (see class docs).",
    );
  }
}
