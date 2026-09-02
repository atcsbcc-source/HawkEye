import { afterEach, describe, expect, it, vi } from "vitest";
import { SIM_CONSTANTS, SimulatorAdapter, gridWaypoints } from "@/lib/drone/simulator";
import type { DroneState, Mission } from "@/lib/ops-types";

describe("gridWaypoints", () => {
  it("lays 34 serpentine rows (68 waypoints) across a 0.012° latitude span", () => {
    const minLat = 35.2;
    const maxLat = 35.212;
    const [minLng, maxLng] = [-80.85, -80.84];
    const wps = gridWaypoints([
      [minLat, minLng],
      [minLat, maxLng],
      [maxLat, maxLng],
      [maxLat, minLng],
    ]);
    expect(wps).toHaveLength(68);

    // Lats are non-decreasing, within the bbox, and identical within each row pair.
    for (let i = 0; i < wps.length; i += 1) {
      expect(wps[i][0]).toBeGreaterThanOrEqual(minLat);
      expect(wps[i][0]).toBeLessThanOrEqual(maxLat);
      if (i > 0) expect(wps[i][0]).toBeGreaterThanOrEqual(wps[i - 1][0]);
    }
    for (let i = 0; i < wps.length; i += 2) {
      expect(wps[i][0]).toBe(wps[i + 1][0]);
      const row = i / 2;
      const [first, second] = row % 2 === 0 ? [minLng, maxLng] : [maxLng, minLng];
      expect(wps[i][1]).toBe(first);
      expect(wps[i + 1][1]).toBe(second);
    }
  });

  it("throws RangeError for a polygon whose float span would never terminate", () => {
    expect(() =>
      gridWaypoints([
        [1e15, 0],
        [1000000000000001, 0],
        [1e15, 1],
      ]),
    ).toThrow(RangeError);
  });

  it("throws RangeError for non-numeric or non-finite coordinates", () => {
    expect(() => gridWaypoints([["a" as unknown as number, 0]])).toThrow(RangeError);
    expect(() => gridWaypoints([[NaN, 0]])).toThrow(RangeError);
    expect(() => gridWaypoints([[Infinity, 0]])).toThrow(RangeError);
    expect(() => gridWaypoints([])).toThrow(RangeError);
  });

  it("produces one row for a degenerate (zero-span) polygon", () => {
    expect(gridWaypoints([[35, -80]])).toEqual([
      [35, -80],
      [35, -80],
    ]);
  });
});

describe("SimulatorAdapter flight", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("walks idle -> enroute -> mapping -> rtb -> idle and completes once", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const completed: string[] = [];
    const sim = new SimulatorAdapter((id) => completed.push(id), { autoStart: false });
    expect(sim.telemetry().state).toBe("idle");

    const [homeLat, homeLng] = SIM_CONSTANTS.HOME;
    const mission: Mission = {
      id: "m-1",
      name: "Test grid",
      polygon: [
        [homeLat + 0.0003, homeLng],
        [homeLat + 0.0003, homeLng + 0.0005],
        [homeLat + 0.0006, homeLng + 0.0005],
        [homeLat + 0.0006, homeLng],
      ],
      status: "queued",
      droneSerial: null,
      progress: 0,
      createdAt: new Date().toISOString(),
      launchedAt: null,
      completedAt: null,
    };

    await sim.launchMission(mission);
    expect(sim.telemetry().state).toBe("enroute");
    expect(sim.telemetry().missionId).toBe("m-1");

    const states: DroneState[] = ["enroute"];
    for (let i = 0; i < 200 && sim.telemetry().state !== "idle"; i += 1) {
      sim.tick();
      const s = sim.telemetry().state;
      if (states[states.length - 1] !== s) states.push(s);
    }

    expect(states).toEqual(["enroute", "mapping", "rtb", "idle"]);
    expect(completed).toEqual(["m-1"]);
    const t = sim.telemetry();
    expect(t.missionId).toBeNull();
    expect(t.missionProgress).toBe(0);
    expect(t.lat).toBeCloseTo(homeLat, 6);
    expect(t.lng).toBeCloseTo(homeLng, 6);
    expect(t.batteryPct).toBeLessThan(100);

    // Further ticks on the pad never re-fire completion.
    for (let i = 0; i < 5; i += 1) sim.tick();
    expect(completed).toHaveLength(1);
  });

  it("launchMission rejects a polygon it cannot route", async () => {
    const sim = new SimulatorAdapter(undefined, { autoStart: false });
    const bad = { id: "x", polygon: [] } as unknown as Mission;
    await expect(sim.launchMission(bad)).rejects.toThrow(RangeError);
    expect(sim.telemetry().state).toBe("idle");
  });

  it("start()/stop() are idempotent and the timer does not keep the process alive", () => {
    const sim = new SimulatorAdapter(undefined, { autoStart: false });
    sim.start();
    sim.start();
    sim.stop();
    sim.stop();
    expect(sim.telemetry().state).toBe("idle");
  });
});
