/**
 * Parameterised serpentine (lawnmower) grid planner.
 *
 * Pure module — no framework or Node imports — so it can be unit-tested and
 * later imported by the simulator (lib/drone/simulator.ts) and the DJI Cloud
 * adapter so every aircraft class flies the same plan.
 *
 * Geometry: rows run east-west (constant latitude) and are spaced by the
 * camera's cross-track ground footprint × (1 − side overlap). Each row is
 * clipped to the polygon with a scanline intersection and its endpoints are
 * verified with a ray-cast point-in-polygon test, so concave AOs never get
 * waypoints outside the boundary.
 */

export type LatLng = [number, number];

export interface CameraModel {
  name: string;
  sensorWidthMm: number;
  sensorHeightMm: number;
  /** Real focal length (not 35 mm equivalent). */
  focalMm: number;
  imageWidthPx: number;
  imageHeightPx: number;
}

/** Hasselblad L2D-20c on the Mavic 3 / Mavic 3 Classic: 4/3 CMOS, 24 mm equiv. */
export const MAVIC_3_CLASSIC: CameraModel = {
  name: "DJI Mavic 3 Classic",
  sensorWidthMm: 17.3,
  sensorHeightMm: 13.0,
  focalMm: 12.29,
  imageWidthPx: 5280,
  imageHeightPx: 3956,
};

export interface GridOptions {
  /** Altitude above takeoff, metres. */
  altitudeM?: number;
  /** Along-track photo overlap, 0..0.95. */
  frontOverlap?: number;
  /** Cross-track (row) overlap, 0..0.95. */
  sideOverlap?: number;
  camera?: CameraModel;
  /** Mapping ground speed, m/s. */
  speedMps?: number;
}

export interface GridPlan {
  waypoints: LatLng[];
  /** Ground sample distance at the planned altitude. */
  gsdCmPerPx: number;
  rowCount: number;
  rowSpacingM: number;
  /** Ground footprint of a single frame, metres. */
  footprintM: { across: number; along: number };
  /** Along-track distance / seconds between exposures for the requested front overlap. */
  photoIntervalM: number;
  photoIntervalS: number;
  /** Total serpentine path length (excluding transit from home). */
  distanceM: number;
  estimatedMinutes: number;
  altitudeM: number;
  speedMps: number;
  camera: CameraModel;
}

export const MAX_ROWS = 500;
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
/** Pull row endpoints this far inside the boundary so they are strictly interior. */
const EDGE_INSET_M = 1;
/** Seconds lost per row turn (deceleration, yaw, acceleration). */
const TURN_OVERHEAD_S = 4;

function assertPolygon(polygon: LatLng[]): void {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new RangeError("polygon needs at least 3 vertices");
  }
  for (const p of polygon) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new RangeError("polygon coordinates must be finite numbers");
    }
    if (Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) {
      throw new RangeError(`polygon coordinate out of range: [${p[0]}, ${p[1]}]`);
    }
  }
}

/** Ray-cast point-in-polygon on an unclosed [lat, lng] ring (even-odd rule). */
export function pointInPolygon(pt: LatLng, polygon: LatLng[]): boolean {
  const [y, x] = pt; // lat, lng
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Sorted longitudes where the horizontal line at `lat` crosses the polygon. */
function scanline(polygon: LatLng[], lat: number): number[] {
  const xs: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > lat !== yj > lat) {
      xs.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
    }
  }
  return xs.sort((a, b) => a - b);
}

export function groundFootprint(
  altitudeM: number,
  camera: CameraModel,
): { across: number; along: number } {
  return {
    across: (altitudeM * camera.sensorWidthMm) / camera.focalMm,
    along: (altitudeM * camera.sensorHeightMm) / camera.focalMm,
  };
}

export function gsdCmPerPx(altitudeM: number, camera: CameraModel): number {
  return (camera.sensorWidthMm * altitudeM * 100) / (camera.focalMm * camera.imageWidthPx);
}

/** Equirectangular distance in metres between two [lat, lng] points. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * M_PER_DEG_LAT;
  const dLng = (b[1] - a[1]) * mPerDegLng((a[0] + b[0]) / 2);
  return Math.hypot(dLat, dLng);
}

export function planGrid(polygon: LatLng[], options: GridOptions = {}): GridPlan {
  assertPolygon(polygon);
  const camera = options.camera ?? MAVIC_3_CLASSIC;
  const altitudeM = options.altitudeM ?? 90;
  const frontOverlap = options.frontOverlap ?? 0.75;
  const sideOverlap = options.sideOverlap ?? 0.65;
  const speedMps = options.speedMps ?? 8;

  for (const [name, v, lo, hi] of [
    ["altitudeM", altitudeM, 5, 500],
    ["frontOverlap", frontOverlap, 0, 0.95],
    ["sideOverlap", sideOverlap, 0, 0.95],
    ["speedMps", speedMps, 0.5, 20],
  ] as const) {
    if (!Number.isFinite(v) || v < lo || v > hi) {
      throw new RangeError(`${name} must be between ${lo} and ${hi}`);
    }
  }

  const footprint = groundFootprint(altitudeM, camera);
  const rowSpacingM = footprint.across * (1 - sideOverlap);
  const photoIntervalM = footprint.along * (1 - frontOverlap);
  const photoIntervalS = Math.max(2, Math.round(photoIntervalM / speedMps));

  const lats = polygon.map((p) => p[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanM = (maxLat - minLat) * M_PER_DEG_LAT;
  const rowStepDeg = rowSpacingM / M_PER_DEG_LAT;

  // Rows sit at minLat + spacing/2 + i*spacing; a very thin AO gets one row.
  const rowCount =
    spanM <= rowSpacingM ? 1 : Math.floor((spanM - rowSpacingM / 2) / rowSpacingM) + 1;
  if (!Number.isFinite(rowCount) || rowCount > MAX_ROWS) {
    throw new RangeError(
      `grid would need ${rowCount} rows (max ${MAX_ROWS}); raise altitude or shrink the AO`,
    );
  }

  const waypoints: LatLng[] = [];
  let leftToRight = true;
  for (let i = 0; i < rowCount; i++) {
    const lat = rowCount === 1 ? (minLat + maxLat) / 2 : minLat + rowStepDeg / 2 + i * rowStepDeg;
    const xs = scanline(polygon, lat);
    if (xs.length < 2) continue;
    const insetDeg = EDGE_INSET_M / mPerDegLng(lat);

    const segments: [number, number][] = [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = xs[k] + insetDeg;
      const b = xs[k + 1] - insetDeg;
      if (b > a) segments.push([a, b]);
    }
    if (segments.length === 0) continue;
    if (!leftToRight) segments.reverse();

    for (const [a, b] of segments) {
      const first: LatLng = [lat, leftToRight ? a : b];
      const second: LatLng = [lat, leftToRight ? b : a];
      if (pointInPolygon(first, polygon)) waypoints.push(first);
      if (pointInPolygon(second, polygon)) waypoints.push(second);
    }
    leftToRight = !leftToRight;
  }

  let distance = 0;
  for (let i = 1; i < waypoints.length; i++) distance += distanceM(waypoints[i - 1], waypoints[i]);
  const estimatedMinutes = (distance / speedMps + rowCount * TURN_OVERHEAD_S) / 60;

  return {
    waypoints,
    gsdCmPerPx: Number(gsdCmPerPx(altitudeM, camera).toFixed(3)),
    rowCount,
    rowSpacingM: Number(rowSpacingM.toFixed(2)),
    footprintM: {
      across: Number(footprint.across.toFixed(1)),
      along: Number(footprint.along.toFixed(1)),
    },
    photoIntervalM: Number(photoIntervalM.toFixed(1)),
    photoIntervalS,
    distanceM: Math.round(distance),
    estimatedMinutes: Number(estimatedMinutes.toFixed(1)),
    altitudeM,
    speedMps,
    camera,
  };
}
