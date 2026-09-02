import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { dedupeParcels, parseParcels, type InvalidRow, type ParsedParcel } from "@/lib/import/parse";
import { mockFindByParcel, mockUpsertProperty } from "@/lib/server/mock-store";
import { pushEvent } from "@/lib/server/ops";

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
export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 5 MB import limit" }, { status: 413 });
  }

  let text: string;
  let filename: string | undefined;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: "multipart body must include a `file` field" }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "File exceeds the 5 MB import limit" }, { status: 413 });
      }
      filename = (file as File).name;
      text = await file.text();
    } else {
      text = await req.text();
      if (text.length > MAX_BYTES) {
        return NextResponse.json({ error: "File exceeds the 5 MB import limit" }, { status: 413 });
      }
    }
  } catch {
    return NextResponse.json({ error: "Could not read upload" }, { status: 400 });
  }
  if (!text.trim()) return NextResponse.json({ error: "Empty upload" }, { status: 400 });

  const parsed = parseParcels(text, filename, contentType.includes("multipart") ? undefined : contentType);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { rows, duplicates } = dedupeParcels(parsed.rows);
  const invalid: InvalidRow[] = [...parsed.invalid, ...duplicates].sort((a, b) => a.row - b.row);

  const db = getServiceSupabase();
  const existing = await existingParcelIds(rows, db);
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
        ...(r.notes ? { notes: r.notes } : {}),
        archived_at: null,
      }));
      const { error } = await db.from("properties").upsert(batch, { onConflict: "parcel_id" });
      if (error) {
        return NextResponse.json(
          { error: `Batch ${i / BATCH + 1} failed: ${error.message}`, imported: i },
          { status: 500 }
        );
      }
    }
  } else {
    for (const r of rows) mockUpsertProperty(r);
  }

  pushEvent({
    actor: "operator",
    eventType: "property.imported",
    subjectType: "property",
    subjectId: null,
    detail: { new: summary.new, updated: summary.updated, invalid: invalid.length, filename: filename ?? null },
  });
  return NextResponse.json(summary);
}

async function existingParcelIds(
  rows: ParsedParcel[],
  db: ReturnType<typeof getServiceSupabase>
): Promise<Set<string>> {
  const ids = rows.map((r) => r.parcel_id);
  const found = new Set<string>();
  if (!db) {
    for (const id of ids) if (mockFindByParcel(id)) found.add(id);
    return found;
  }
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data } = await db
      .from("properties")
      .select("parcel_id")
      .in("parcel_id", ids.slice(i, i + BATCH));
    for (const r of data ?? []) found.add(r.parcel_id);
  }
  return found;
}
