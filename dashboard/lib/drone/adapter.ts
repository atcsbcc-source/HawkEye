import type { Mission, Telemetry } from "../ops-types";

/**
 * Uniform contract between the ops console and any aircraft backend.
 *
 * Implementations:
 *  - SimulatorAdapter (lib/drone/simulator.ts) — in-process flight model so
 *    the console is fully operable with zero hardware.
 *  - DjiCloudAdapter (lib/drone/djiCloud.ts) — DJI Cloud API bridge for
 *    SDK/enterprise aircraft (Mavic 3E/3T, Matrice, Dock). Wire up an MQTT
 *    broker and it drops in here; nothing above this interface changes.
 */
export interface DroneAdapter {
  readonly serial: string;
  readonly model: string;

  /** Latest telemetry snapshot (adapters push internally at >= 1 Hz). */
  telemetry(): Telemetry;

  /** Begin executing a mapping mission over the mission's polygon. */
  launchMission(mission: Mission): Promise<void>;

  /** Abort the active mission and return to home. */
  abortMission(): Promise<void>;
}
