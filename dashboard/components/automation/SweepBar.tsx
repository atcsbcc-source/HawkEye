"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { AuditEvent } from "@/lib/ops-types";

interface SweepSummary {
  scanned: number;
  fired: number;
  skipped: number;
  dispatched?: number;
  minDays?: number | null;
  at: string;
}

/** 'Run sweep now' + last-sweep summary (from the newest automation.sweep audit event). */
export function SweepBar() {
  const [last, setLast] = useState<SweepSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLast = useCallback(async () => {
    try {
      const res = await fetch("/api/audit");
      const json = await res.json();
      const ev = (json.events as AuditEvent[] | undefined)?.find((e) => e.eventType === "automation.sweep");
      if (ev) {
        const d = ev.detail as Record<string, number | null | undefined>;
        setLast({
          scanned: Number(d.scanned ?? 0),
          fired: Number(d.fired ?? 0),
          skipped: Number(d.skipped ?? 0),
          dispatched: d.dispatched == null ? undefined : Number(d.dispatched),
          minDays: d.minDays ?? null,
          at: ev.occurredAt,
        });
      }
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    loadLast();
  }, [loadLast]);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/automation/sweep", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `Sweep failed (${res.status})`);
        return;
      }
      setLast({
        scanned: json.scanned,
        fired: json.fired,
        skipped: json.skipped,
        dispatched: json.dispatched,
        minDays: json.minDays,
        at: json.ranAt ?? new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Distress sweep</p>
        <p className="mt-1 text-xs text-slate-400">
          {last ? (
            <>
              Last sweep {new Date(last.at).toLocaleString()} · scanned{" "}
              <span className="text-slate-100 tabular-nums">{last.scanned}</span> · fired{" "}
              <span className="text-amber-300 tabular-nums">{last.fired}</span> · skipped{" "}
              <span className="text-slate-100 tabular-nums">{last.skipped}</span>
              {last.dispatched !== undefined && (
                <>
                  {" "}
                  · dispatched <span className="text-emerald-300 tabular-nums">{last.dispatched}</span>
                </>
              )}
              {last.minDays != null && <span className="text-slate-500"> · threshold {last.minDays}d</span>}
            </>
          ) : (
            "No sweep recorded yet. Scheduled daily at 13:00 UTC via vercel.json; run it now to evaluate distress rules against flagged parcels."
          )}
        </p>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Run sweep now
      </button>
    </div>
  );
}
