import { z } from "zod";

/**
 * Pure parsers for the parcel import endpoint. No I/O, no framework imports —
 * unit-tested under __tests__/features/parse.test.ts.
 *
 * Accepted inputs:
 *   * CSV with a header row containing parcel_id, address, lat, lng
 *     (any order, case-insensitive; optional neighborhood, notes)
 *   * GeoJSON FeatureCollection — Point features are used directly, Polygon /
 *     MultiPolygon features contribute their (area-weighted) centroid.
 */

export interface ParsedParcel {
  /** 1-based source row (CSV data row, or feature index) for error reporting. */
  row: number;
  parcel_id: string;
  address: string;
  lat: number;
  lng: number;
  neighborhood: string | null;
  notes: string | null;
}

export interface InvalidRow {
  row: number;
  reason: string;
}

export interface ParseResult {
  rows: ParsedParcel[];
  invalid: InvalidRow[];
  /** Set when the whole file is unusable (bad header, not a FeatureCollection). */
  error?: string;
}

export const REQUIRED_COLUMNS = ["parcel_id", "address", "lat", "lng"] as const;
export const OPTIONAL_COLUMNS = ["neighborhood", "notes"] as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const ParcelRowSchema = z.object({
  parcel_id: trimmed(64),
  address: trimmed(200),
  lat: z.coerce.number().refine(Number.isFinite, "lat must be a number").min(-90).max(90),
  lng: z.coerce.number().refine(Number.isFinite, "lng must be a number").min(-180).max(180),
  neighborhood: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export function validateParcel(
  raw: Record<string, unknown>,
  row: number,
): { ok: true; value: ParsedParcel } | { ok: false; reason: string } {
  const res = ParcelRowSchema.safeParse(raw);
  if (!res.success) {
    const reason = res.error.issues
      .map((i) => `${i.path.join(".") || "row"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason };
  }
  const v = res.data;
  return {
    ok: true,
    value: {
      row,
      parcel_id: v.parcel_id,
      address: v.address,
      lat: v.lat,
      lng: v.lng,
      neighborhood: v.neighborhood ? v.neighborhood : null,
      notes: v.notes ? v.notes : null,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180-ish: quoted fields, doubled quotes, CR/LF line endings. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  // Drop fully blank lines.
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const HEADER_ALIASES: Record<string, string> = {
  parcel_id: "parcel_id",
  parcelid: "parcel_id",
  parcel: "parcel_id",
  apn: "parcel_id",
  pin: "parcel_id",
  address: "address",
  situs: "address",
  situs_address: "address",
  lat: "lat",
  latitude: "lat",
  y: "lat",
  lng: "lng",
  lon: "lng",
  long: "lng",
  longitude: "lng",
  x: "lng",
  neighborhood: "neighborhood",
  neighbourhood: "neighborhood",
  grid: "neighborhood",
  notes: "notes",
  note: "notes",
};

function normalizeHeader(h: string): string | null {
  const key = h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return HEADER_ALIASES[key] ?? null;
}

export function parseCsv(text: string): ParseResult {
  const table = splitCsv(text);
  if (table.length === 0) return { rows: [], invalid: [], error: "CSV is empty" };

  const header = table[0].map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      invalid: [],
      error: `CSV header must include ${REQUIRED_COLUMNS.join(", ")} (missing: ${missing.join(", ")})`,
    };
  }

  const rows: ParsedParcel[] = [];
  const invalid: InvalidRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const raw: Record<string, unknown> = {};
    table[i].forEach((cell, col) => {
      const name = header[col];
      if (name) raw[name] = cell;
    });
    const rowNo = i; // data row number, header is row 0
    const res = validateParcel(raw, rowNo);
    if (res.ok) rows.push(res.value);
    else invalid.push({ row: rowNo, reason: res.reason });
  }
  return { rows, invalid };
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

type Position = number[];

/** Area-weighted centroid of a (closed or unclosed) ring, in [lng, lat]. Falls
 *  back to the vertex mean for degenerate (zero-area) rings. */
export function polygonCentroid(ring: Position[]): [number, number] {
  const pts = ring.filter((p) => Array.isArray(p) && p.length >= 2);
  if (pts.length === 0) return [NaN, NaN];
  const closed =
    pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
      ? pts.slice(0, -1)
      : pts;
  // Work relative to the first vertex: the shoelace sum cancels catastrophically
  // when |lng| ~ 80 and the parcel is ~1e-4 degrees wide.
  const [ox, oy] = closed[0];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < closed.length; i++) {
    const x0 = closed[i][0] - ox;
    const y0 = closed[i][1] - oy;
    const x1 = closed[(i + 1) % closed.length][0] - ox;
    const y1 = closed[(i + 1) % closed.length][1] - oy;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-18) {
    const mx = closed.reduce((a, p) => a + p[0], 0) / closed.length;
    const my = closed.reduce((a, p) => a + p[1], 0) / closed.length;
    return [mx, my];
  }
  area *= 0.5;
  return [ox + cx / (6 * area), oy + cy / (6 * area)];
}

function pickProp(props: Record<string, unknown>, names: string[]): unknown {
  const lower = new Map(Object.keys(props).map((k) => [k.toLowerCase(), k]));
  for (const n of names) {
    const key = lower.get(n.toLowerCase());
    if (key !== undefined && props[key] !== undefined && props[key] !== null) return props[key];
  }
  return undefined;
}

function geometryPoint(geom: any): [number, number] | null {
  if (!geom || typeof geom !== "object") return null;
  switch (geom.type) {
    case "Point":
      return Array.isArray(geom.coordinates) && geom.coordinates.length >= 2
        ? [Number(geom.coordinates[0]), Number(geom.coordinates[1])]
        : null;
    case "Polygon":
      return Array.isArray(geom.coordinates?.[0]) ? polygonCentroid(geom.coordinates[0]) : null;
    case "MultiPolygon": {
      // Use the largest outer ring by vertex count as the representative parcel.
      const rings: Position[][] = (geom.coordinates ?? [])
        .map((poly: Position[][]) => poly?.[0])
        .filter(Boolean);
      if (rings.length === 0) return null;
      rings.sort((a, b) => b.length - a.length);
      return polygonCentroid(rings[0]);
    }
    default:
      return null;
  }
}

export function parseGeoJson(input: unknown): ParseResult {
  let doc: any = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch {
      return { rows: [], invalid: [], error: "GeoJSON is not valid JSON" };
    }
  }
  if (!doc || doc.type !== "FeatureCollection" || !Array.isArray(doc.features)) {
    return {
      rows: [],
      invalid: [],
      error: "GeoJSON must be a FeatureCollection with a features array",
    };
  }
  const rows: ParsedParcel[] = [];
  const invalid: InvalidRow[] = [];
  doc.features.forEach((feature: any, idx: number) => {
    const row = idx + 1;
    const props: Record<string, unknown> =
      feature && typeof feature.properties === "object" && feature.properties
        ? feature.properties
        : {};
    const pt = geometryPoint(feature?.geometry);
    if (!pt) {
      invalid.push({ row, reason: "geometry: expected Point, Polygon or MultiPolygon" });
      return;
    }
    const raw = {
      parcel_id: pickProp(props, ["parcel_id", "parcelid", "apn", "pin", "parcel"]),
      address: pickProp(props, ["address", "situs", "situs_address", "site_address"]),
      lat: pt[1],
      lng: pt[0],
      neighborhood: pickProp(props, ["neighborhood", "neighbourhood", "grid"]) ?? null,
      notes: pickProp(props, ["notes", "note"]) ?? null,
    };
    if (raw.parcel_id !== undefined && typeof raw.parcel_id !== "string")
      raw.parcel_id = String(raw.parcel_id);
    if (raw.address !== undefined && typeof raw.address !== "string")
      raw.address = String(raw.address);
    if (raw.neighborhood !== null && typeof raw.neighborhood !== "string")
      raw.neighborhood = String(raw.neighborhood);
    if (raw.notes !== null && typeof raw.notes !== "string") raw.notes = String(raw.notes);
    const res = validateParcel(raw, row);
    if (res.ok) rows.push(res.value);
    else invalid.push({ row, reason: res.reason });
  });
  return { rows, invalid };
}

// ---------------------------------------------------------------------------
// Dispatch on content
// ---------------------------------------------------------------------------
export function detectFormat(
  text: string,
  filename?: string,
  contentType?: string,
): "csv" | "geojson" {
  const name = (filename ?? "").toLowerCase();
  const ct = (contentType ?? "").toLowerCase();
  if (name.endsWith(".geojson") || name.endsWith(".json") || ct.includes("json")) return "geojson";
  if (name.endsWith(".csv") || ct.includes("csv")) return "csv";
  return text.trimStart().startsWith("{") ? "geojson" : "csv";
}

export function parseParcels(text: string, filename?: string, contentType?: string): ParseResult {
  return detectFormat(text, filename, contentType) === "geojson"
    ? parseGeoJson(text)
    : parseCsv(text);
}

/** De-duplicate on parcel_id (last occurrence wins) and report the dropped rows. */
export function dedupeParcels(rows: ParsedParcel[]): {
  rows: ParsedParcel[];
  duplicates: InvalidRow[];
} {
  const byId = new Map<string, ParsedParcel>();
  const duplicates: InvalidRow[] = [];
  for (const r of rows) {
    const prev = byId.get(r.parcel_id);
    if (prev)
      duplicates.push({
        row: prev.row,
        reason: `duplicate parcel_id ${r.parcel_id} (superseded by row ${r.row})`,
      });
    byId.set(r.parcel_id, r);
  }
  return { rows: Array.from(byId.values()), duplicates };
}
