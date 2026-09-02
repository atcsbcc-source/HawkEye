import { describe, expect, it } from "vitest";
import {
  MAVIC_3_CLASSIC,
  MAX_ROWS,
  planGrid,
  pointInPolygon,
  type LatLng,
} from "../../lib/drone/grid";

/** 0.012° × 0.012° box (~1.3 km × 1.1 km) around the Oakwood AO. */
const BOX: LatLng[] = [
  [35.218, -80.852],
  [35.218, -80.84],
  [35.23, -80.84],
  [35.23, -80.852],
];

describe("planGrid", () => {
  it("yields a deterministic serpentine over a 0.012° box", () => {
    const a = planGrid(BOX);
    const b = planGrid(BOX);
    expect(a).toEqual(b);
    // 1335 m of latitude at 44.3 m row spacing (65 % side overlap at 90 m) -> 30 rows.
    expect(a.rowCount).toBe(30);
    expect(a.waypoints.length).toBe(a.rowCount * 2);
    expect(a.rowSpacingM).toBeCloseTo(44.34, 1);
    expect(a.gsdCmPerPx).toBeCloseTo(2.4, 1);
    expect(a.distanceM).toBeGreaterThan(30 * 1000);
    expect(a.estimatedMinutes).toBeGreaterThan(0);
  });

  it("alternates row direction (serpentine)", () => {
    const { waypoints } = planGrid(BOX);
    // Row 0 runs west->east, row 1 east->west, so consecutive rows share a side.
    expect(waypoints[0][1]).toBeLessThan(waypoints[1][1]);
    expect(waypoints[2][1]).toBeGreaterThan(waypoints[3][1]);
    expect(waypoints[1][1]).toBeCloseTo(waypoints[2][1], 9);
  });

  it("keeps every waypoint strictly inside the polygon", () => {
    const { waypoints } = planGrid(BOX);
    for (const wp of waypoints) expect(pointInPolygon(wp, BOX)).toBe(true);
  });

  it("clips rows to a concave polygon rather than its bounding box", () => {
    // L-shape: the NE quadrant is cut out.
    const L: LatLng[] = [
      [35.218, -80.852],
      [35.218, -80.84],
      [35.224, -80.84],
      [35.224, -80.846],
      [35.23, -80.846],
      [35.23, -80.852],
    ];
    const plan = planGrid(L);
    expect(plan.waypoints.length).toBeGreaterThan(0);
    for (const wp of plan.waypoints) expect(pointInPolygon(wp, L)).toBe(true);
    const upperRows = plan.waypoints.filter((wp) => wp[0] > 35.224);
    expect(upperRows.length).toBeGreaterThan(0);
    for (const wp of upperRows) expect(wp[1]).toBeLessThan(-80.846);
  });

  it("responds to altitude and overlap parameters", () => {
    const low = planGrid(BOX, { altitudeM: 60 });
    const high = planGrid(BOX, { altitudeM: 120 });
    expect(low.rowCount).toBeGreaterThan(high.rowCount);
    expect(low.gsdCmPerPx).toBeLessThan(high.gsdCmPerPx);
    const dense = planGrid(BOX, { sideOverlap: 0.8 });
    expect(dense.rowCount).toBeGreaterThan(planGrid(BOX).rowCount);
    expect(planGrid(BOX, { camera: MAVIC_3_CLASSIC }).camera.name).toContain("Mavic 3");
  });

  it("throws RangeError on absurd coordinates instead of looping", () => {
    const huge: LatLng[] = [
      [0, 0],
      [0, 1],
      [1e15, 1],
      [1e15, 0],
    ];
    expect(() => planGrid(huge)).toThrow(RangeError);
    const wide: LatLng[] = [
      [0, -80],
      [0, -79],
      [89, -79],
      [89, -80],
    ];
    // ~9 900 km of latitude at ~44 m rows -> far more than MAX_ROWS.
    expect(() => planGrid(wide)).toThrow(RangeError);
    expect(MAX_ROWS).toBe(500);
  });

  it("throws RangeError on NaN / non-finite input", () => {
    expect(() =>
      planGrid([
        [NaN, 0],
        [0, 1],
        [1, 1],
      ]),
    ).toThrow(RangeError);
    expect(() =>
      planGrid([
        [0, Infinity],
        [0, 1],
        [1, 1],
      ]),
    ).toThrow(RangeError);
    expect(() => planGrid(BOX, { altitudeM: NaN })).toThrow(RangeError);
    expect(() =>
      planGrid([
        [0, 0],
        [0, 1],
      ]),
    ).toThrow(RangeError);
  });
});
