import { describe, expect, it } from "vitest";
import { upsertBatches } from "../../lib/import/upsert";
import type { ParsedParcel } from "../../lib/import/parse";

const row = (parcel_id: string, notes: string | null): ParsedParcel => ({
  row: 1,
  parcel_id,
  address: `${parcel_id} Main St`,
  lat: 35.2,
  lng: -80.8,
  neighborhood: null,
  notes,
});

describe("upsertBatches", () => {
  it("never mixes rows with and without notes in one batch", () => {
    const batches = upsertBatches([row("A", "keep me"), row("B", null), row("C", "")], 500);
    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      const hasNotes = batch.map((r) => "notes" in r);
      expect(new Set(hasNotes).size).toBe(1);
    }
    const noteless = batches.find((b) => !("notes" in b[0]))!;
    expect(noteless.map((r) => r.parcel_id).sort()).toEqual(["B", "C"]);
    expect(noteless.every((r) => !Object.hasOwn(r, "notes"))).toBe(true);
    const noted = batches.find((b) => "notes" in b[0])!;
    expect(noted).toEqual([expect.objectContaining({ parcel_id: "A", notes: "keep me" })]);
  });

  it("respects the batch size within each group and un-archives every row", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`P${i}`, i % 2 ? "n" : null));
    const batches = upsertBatches(rows, 2);
    expect(batches.map((b) => b.length)).toEqual([2, 1, 2]);
    expect(batches.flat().every((r) => r.archived_at === null)).toBe(true);
    expect(batches.flat()).toHaveLength(5);
  });
});
