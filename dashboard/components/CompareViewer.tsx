"use client";

import { useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Loader2, Send, SlidersHorizontal } from "lucide-react";
import type { PropertyScan } from "@/lib/types";

/**
 * Side-by-side (swipe) comparison of baseline vs selected-week imagery for
 * manual verification, with the CRM dispatch action gated behind it.
 */
export function CompareViewer({
  propertyId,
  scans,
  alreadyDispatched,
}: {
  propertyId: string;
  scans: PropertyScan[]; // newest first
  alreadyDispatched: boolean;
}) {
  const [scanIdx, setScanIdx] = useState(0);
  const [split, setSplit] = useState(50);
  const [dispatchState, setDispatchState] = useState<
    "idle" | "sending" | "sent" | "error"
  >(alreadyDispatched ? "sent" : "idle");

  if (scans.length === 0) {
    return (
      <p className="rounded-xl border border-surface-border bg-surface-raised p-6 text-sm text-slate-400">
        No scans yet for this property — it will appear after the next flight is
        processed.
      </p>
    );
  }

  const selected = scans[scanIdx];
  // Baseline = oldest available "previous" crop (Week 1); right = selected week.
  const oldest = scans[scans.length - 1];
  const baselineUrl = oldest.image_url_previous ?? oldest.image_url_current;

  async function dispatchLead() {
    setDispatchState("sending");
    try {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, scanId: selected.id }),
      });
      setDispatchState(res.ok ? "sent" : "error");
    } catch {
      setDispatchState("error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {scans.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setScanIdx(i)}
            className={clsx(
              "rounded-lg border px-3 py-1.5 text-xs transition",
              i === scanIdx
                ? "border-sky-500 bg-sky-500/10 text-sky-300"
                : "border-surface-border text-slate-400 hover:text-white"
            )}
          >
            {s.flight?.flight_code ?? new Date(s.processed_at).toLocaleDateString()}
          </button>
        ))}
      </div>

      {/* Swipe comparator: baseline underneath, selected week clipped on top. */}
      <div className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-xl border border-surface-border bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={baselineUrl}
          alt="Baseline (Week 1)"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={selected.image_url_current}
          alt="Selected week"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
          draggable={false}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-amber-400"
          style={{ left: `${split}%` }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label="Comparison slider"
          className="absolute inset-x-0 bottom-3 mx-auto w-11/12 accent-amber-400"
        />
        <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[11px] text-slate-200">
          Week 1 baseline
        </span>
        <span className="absolute right-3 top-3 rounded bg-black/70 px-2 py-1 text-[11px] text-slate-200">
          {selected.flight?.flight_code ?? "Selected week"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Vacancy confidence" value={`${selected.vacancy_confidence}`} />
        <Metric
          label="Lawn growth index"
          value={selected.lawn_growth_index?.toFixed(2) ?? "—"}
        />
        <Metric
          label="Change score"
          value={selected.change_score != null ? `${selected.change_score}%` : "—"}
        />
        <Metric
          label="Vehicle"
          value={
            selected.vehicle_present
              ? selected.vehicle_static
                ? "static"
                : "present"
              : "none"
          }
        />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised p-4">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <SlidersHorizontal className="h-4 w-4" />
          Verify imagery manually before dispatching to the CRM.
        </div>
        <button
          onClick={dispatchLead}
          disabled={dispatchState === "sending" || dispatchState === "sent"}
          className={clsx(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
            dispatchState === "sent"
              ? "cursor-default bg-emerald-600/20 text-emerald-300"
              : "bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-60"
          )}
        >
          {dispatchState === "sending" && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {dispatchState === "sent" ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Dispatched
            </>
          ) : (
            <>
              <Send className="h-4 w-4" /> Dispatch lead to CRM
            </>
          )}
        </button>
      </div>
      {dispatchState === "error" && (
        <p className="text-xs text-red-400">
          Dispatch failed — check CRM_WEBHOOK_URL and server logs.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
