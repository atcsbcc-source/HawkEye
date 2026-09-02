"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { FileUp, Loader2, X } from "lucide-react";
import { useFocusTrap } from "@/lib/ui/useFocusTrap";

interface Preview {
  new: number;
  updated: number;
  invalid: { row: number; reason: string }[];
  total: number;
  preview?: {
    row: number;
    parcel_id: string;
    address: string;
    lat: number;
    lng: number;
    neighborhood: string | null;
  }[];
}

const TITLE_ID = "import-parcels-title";

/**
 * CSV / GeoJSON parcel import. Step 1 uploads with ?dryRun=1 and renders the
 * preview + error rows; step 2 commits the same file. The grid is refreshed
 * when the dialog closes after a commit — refreshing immediately would remount
 * the page and unmount this dialog before the summary is shown.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Tab never leaves the modal (the grid behind the backdrop stays unreachable).
  useFocusTrap(dialogRef);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"idle" | "previewing" | "importing" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const committed = result !== null;

  function close() {
    onClose();
    if (committed) router.refresh();
  }

  // Focus moves into the dialog on open and back to the trigger on close;
  // Escape closes (see MobileNav for the same pattern).
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    (fileRef.current ?? closeRef.current)?.focus();
    return () => trigger?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, onClose]);

  async function send(dryRun: boolean) {
    if (!file) return;
    setState(dryRun ? "previewing" : "importing");
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/properties/import${dryRun ? "?dryRun=1" : ""}`, {
        method: "POST",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `Import failed (${res.status})`);
        setState("error");
        return;
      }
      if (dryRun) {
        setPreview(json);
        setState("idle");
      } else {
        setResult(json);
        setState("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  }

  const busy = state === "previewing" || state === "importing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="w-full max-w-2xl space-y-4 rounded-xl border border-surface-border bg-surface-raised p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <p
              id={TITLE_ID}
              className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400"
            >
              Import parcels
            </p>
            <p className="mt-1 text-xs text-slate-400">
              CSV with{" "}
              <code className="text-slate-300">parcel_id,address,lat,lng[,neighborhood,notes]</code>{" "}
              or a GeoJSON FeatureCollection (Point or Polygon features). Existing parcel IDs are
              updated. Max 5 MB.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="rounded-md p-1 text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.geojson,.json,text/csv,application/geo+json,application/json"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
              setError(null);
              setState("idle");
            }}
            className="text-xs text-slate-300 file:mr-3 file:rounded-md file:border file:border-surface-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
          />
          <button
            type="button"
            onClick={() => send(true)}
            disabled={!file || busy}
            className="flex items-center gap-2 rounded-lg border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
          >
            {state === "previewing" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileUp className="h-3.5 w-3.5" />
            )}
            Preview (dry run)
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {(preview || result) && <Summary data={(result ?? preview)!} committed={committed} />}

        {preview && !result && (
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={close}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => send(false)}
              disabled={busy || preview.new + preview.updated === 0}
              className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
            >
              {state === "importing" && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {preview.new + preview.updated} parcels
            </button>
          </div>
        )}
        {result && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-emerald-600/20 px-4 py-2 text-sm text-emerald-300"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ data, committed }: { data: Preview; committed: boolean }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label={committed ? "Created" : "New"} value={data.new} tone="emerald" />
        <Stat label={committed ? "Updated" : "Will update"} value={data.updated} tone="sky" />
        <Stat
          label="Invalid"
          value={data.invalid.length}
          tone={data.invalid.length ? "red" : "slate"}
        />
      </div>

      {data.preview && data.preview.length > 0 && !committed && (
        <div className="max-h-48 overflow-auto rounded-lg border border-surface-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface text-label uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Parcel</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Lat / Lng</th>
                <th className="px-3 py-2">Neighborhood</th>
              </tr>
            </thead>
            <tbody>
              {data.preview.map((r) => (
                <tr key={r.row} className="border-t border-surface-border/60 text-slate-300">
                  <td className="px-3 py-1.5 font-mono text-slate-400">{r.row}</td>
                  <td className="px-3 py-1.5 font-mono">{r.parcel_id}</td>
                  <td className="px-3 py-1.5">{r.address}</td>
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                  </td>
                  <td className="px-3 py-1.5">{r.neighborhood ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.invalid.length > 0 && (
        <div className="max-h-40 overflow-auto rounded-lg border border-red-500/30 bg-red-500/5">
          <table className="w-full text-left text-xs">
            <tbody>
              {data.invalid.map((r, i) => (
                <tr key={`${r.row}-${i}`} className="border-t border-red-500/20 text-red-200">
                  <td className="w-16 px-3 py-1.5 font-mono">row {r.row}</td>
                  <td className="px-3 py-1.5">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "sky" | "red" | "slate";
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3">
      <p className="text-label uppercase text-slate-400">{label}</p>
      <p
        className={clsx(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "emerald" && "text-emerald-300",
          tone === "sky" && "text-sky-300",
          tone === "red" && "text-red-300",
          tone === "slate" && "text-slate-300",
        )}
      >
        {value}
      </p>
    </div>
  );
}
