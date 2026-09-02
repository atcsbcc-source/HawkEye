import type { ParsedParcel } from "./parse";

/**
 * Row shape sent to `properties.upsert(..., { onConflict: "parcel_id" })`.
 * `notes` is present only when the import supplies one.
 */
export interface UpsertRow {
  parcel_id: string;
  address: string;
  lat: number;
  lng: number;
  neighborhood: string | null;
  notes?: string;
  archived_at: null;
}

/**
 * Group parsed rows into upsert batches such that every batch either has a
 * `notes` key on EVERY row or on NONE of them.
 *
 * postgrest-js sends `columns=<union of keys across the batch>` and fills a
 * missing key with NULL, so a batch mixing rows with and without notes would
 * overwrite the existing note of every note-less row. Splitting keeps the
 * "blank cell keeps the existing note" contract the dry run / mock store show.
 */
export function upsertBatches(rows: ParsedParcel[], batchSize: number): UpsertRow[][] {
  const withNotes: UpsertRow[] = [];
  const withoutNotes: UpsertRow[] = [];
  for (const r of rows) {
    const base = {
      parcel_id: r.parcel_id,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      neighborhood: r.neighborhood,
      archived_at: null as null,
    };
    if (r.notes) withNotes.push({ ...base, notes: r.notes });
    else withoutNotes.push(base);
  }
  const batches: UpsertRow[][] = [];
  for (const group of [withoutNotes, withNotes]) {
    for (let i = 0; i < group.length; i += batchSize) batches.push(group.slice(i, i + batchSize));
  }
  return batches;
}
