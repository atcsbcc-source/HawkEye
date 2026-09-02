import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  dedupeParcels,
  parseParcels,
  type InvalidRow,
  type ParsedParcel,
} from "@/lib/import/parse";
import { mockFindByParcel, mockUpsertProperty } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { must } from "@/lib/server/db";
import { apiError } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const BATCH = 500;

/**
 * POST /api/properties/import[?dryRun=1]
 *
 * Body: multipart/form-data with a `file` field (CSV or GeoJSON), or the raw
 * CSV / GeoJSON text with a matching Content-Type. Upserts on parcel_id in
 * batches of 500. `dryRun=1` only reports what would happen:
 *   { new, updated, invalid: [{row, reason}], total }
 */
export const POST = withAuth(async (req, user) => {
  const rl = rateLimit("properties:import", user.id, 10);
  if (!rl.ok) return rateLimitResponse(rl);

  const url = new URL(req.url);
  const dryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return apiError("File exceeds the 5 MB import limit", 413);

  let text: string;
  let filename: string | undefined;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return apiError("multipart body must include a `file` field", 400);
      }
      if (file.size > MAX_BYTES) return apiError("File exceeds the 5 MB import limit", 413);
      filename = (file as File).name;
      text = await file.text();
    } else {
      text = await req.text();
      if (text.length > MAX_BYTES) return apiError("File exceeds the 5 MB import limit", 413);
    }
  } catch {
    return apiError("Could not read upload", 400);
  }
  if (!text.trim()) return apiError("Empty upload", 400);

  const parsed = parseParcels(
    text,
    filename,
    contentType.includes("multipart") ? undefined : contentType,
  );
  if (parsed.error) return apiError(parsed.error, 400);

  const { rows, duplicates } = dedupeParcels(parsed.rows);
  const invalid: InvalidRow[] = [...parsed.invalid, ...duplicates].sort((a, b) => a.row - b.row);

  const db = getServiceSupabase();
  let existing: Set<string>;
  try {
    existing = await existingParcelIds(rows, db);
  } catch (err) {
    console.error("[import] lookup failed", err);
    return apiError("Could not check existing parcels", 500);
  }
  const newRows = rows.filter((r) => !existing.has(r.parcel_id));
  const updatedRows = rows.filter((r) => existing.has(r.parcel_id));

  const summary = {
    new: newRows.length,
    updated: updatedRows.length,
    invalid,
    total: parsed.rows.length + parsed.invalid.length,
    dryRun,
    preview: rows.slice(0, 25),
  };
  if (dryRun) return NextResponse.json(summary);

  if (db) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map((r) => ({
        parcel_id: r.parcel_id,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        neighborhood: r.neighborhood,
        // Blank cells keep the existing note (mock-store mirrors this).
        ...(r.notes ? { notes: r.notes } : {}),
        archived_at: null,
      }));
      const { error } = await db.from("properties").upsert(batch, { onConflict: "parcel_id" });
      if (error) {
        console.error("[import] batch failed", i / BATCH + 1, error.code);
        return NextResponse.json(
          { error: `Batch ${i / BATCH + 1} failed; ${i} rows were imported`, imported: i },
          { status: 500 },
        );
      }
    }
  } else {
    for (const r of rows) mockUpsertProperty(r);
  }

  pushEvent({
    actor: user.email,
    actorUserId: user.id,
    eventType: "property.imported",
    subjectType: "property",
    subjectId: null,
    detail: {
      new: summary.new,
      updated: summary.updated,
      invalid: invalid.length,
      filename: filename ?? null,
    },
  });
  return NextResponse.json(summary);
});

/** Throws DbError when a lookup fails so a dry run never reports every row as new. */
async function existingParcelIds(
  rows: ParsedParcel[],
  db: ReturnType<typeof getServiceSupabase>,
): Promise<Set<string>> {
  const ids = rows.map((r) => r.parcel_id);
  const found = new Set<string>();
  if (!db) {
    for (const id of ids) if (mockFindByParcel(id)) found.add(id);
    return found;
  }
  for (let i = 0; i < ids.length; i += BATCH) {
    const data = await must(
      db
        .from("properties")
        .select("parcel_id")
        .in("parcel_id", ids.slice(i, i + BATCH)),
      "select properties.parcel_id",
    );
    for (const r of data ?? []) found.add(r.parcel_id);
  }
  return found;
}
