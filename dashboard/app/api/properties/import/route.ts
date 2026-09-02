import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  dedupeParcels,
  parseParcels,
  type InvalidRow,
  type ParsedParcel,
} from "@/lib/import/parse";
import { upsertBatches } from "@/lib/import/upsert";
import { mockFindByParcel, mockUpsertProperty } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";
import { withAuth } from "@/lib/server/auth";
import { must } from "@/lib/server/db";
import { apiError, BodyTooLarge, readCappedBytes } from "@/lib/server/validate";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const BATCH = 500;
const TOO_LARGE = "File exceeds the 5 MB import limit";

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
  if (declared > MAX_BYTES) return apiError(TOO_LARGE, 413);

  let text: string;
  let filename: string | undefined;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    // Stream with a hard cap: a chunked (Content-Length-less) upload must not
    // be buffered in full by req.text() / req.formData() before the size check.
    // (Self-hosted `next start` still tees every mutating body for the
    // middleware sandbox — next/dist/server/body-streams.js — which is a
    // per-request framework cost outside this handler; Vercel caps bodies at
    // 4.5 MB before the function runs.)
    const bytes = await readCappedBytes(req, MAX_BYTES);
    if (contentType.includes("multipart/form-data")) {
      const form = await new Response(bytes, {
        headers: { "content-type": contentType },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return apiError("multipart body must include a `file` field", 400);
      }
      filename = (file as File).name;
      text = await file.text();
    } else {
      text = new TextDecoder().decode(bytes);
    }
  } catch (err) {
    if (err instanceof BodyTooLarge) return apiError(TOO_LARGE, 413);
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
    // Blank note cells keep the existing note (mock-store mirrors this): rows
    // with and without `notes` go in separate batches so postgrest never sends
    // `notes: null` for the note-less ones.
    const batches = upsertBatches(rows, BATCH);
    let imported = 0;
    for (let n = 0; n < batches.length; n++) {
      const batch = batches[n];
      const { error } = await db.from("properties").upsert(batch, { onConflict: "parcel_id" });
      if (error) {
        console.error("[import] batch failed", n + 1, error.code);
        return NextResponse.json(
          { error: `Batch ${n + 1} failed; ${imported} rows were imported`, imported },
          { status: 500 },
        );
      }
      imported += batch.length;
    }
  } else {
    for (const r of rows) mockUpsertProperty(r);
  }

  await pushEvent({
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
