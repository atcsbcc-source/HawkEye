"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { AuditEvent } from "@/lib/ops-types";
import { fmtDateTime } from "@/lib/format";

interface SweepFailure {
  reason: string;
  kind?: string | null;
  count: number;
}

interface SweepSummary {
  scanned: number;
  fired: number;
  /** Actions that ran but failed (webhook error / no URL) — retried next sweep. */
  failed?: number;
  skipped: number;
  dispatched?: number;
  /** Distinct failure reasons behind `failed`. */
  failures?: SweepFailure[];
  minDays?: number | null;
  at: string;
}

/** Operator-facing hint for a failure class the sweep reports. */
function failureHint(f: SweepFailure): string {
  switch (f.kind) {
    case "unconfigured":
      return "set CRM_WEBHOOK_URL or a rule URL";
    case "mock_mode":
      return "configure Supabase to deliver webhooks";
    case "unsafe_url":
      return "webhook must be a public https URL (see WEBHOOK_ALLOWED_HOSTS)";
    case "timeout":
    case "network":
    case "http":
      return "CRM did not accept the lead; retried next sweep";
    default:
      return "";
  }
}

function parseFailures(v: unknown): SweepFailure[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((f): f is SweepFailure => Boolean(f) && typeof f.reason === "string")
    .map((f) => ({ reason: f.reason, kind: f.kind ?? null, count: Number(f.count ?? 1) }));
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
      const ev = (json.events as AuditEvent[] | undefined)?.find(
        (e) => e.eventType === "automation.sweep",
      );
      if (ev) {
        const d = ev.detail as Record<string, unknown>;
        setLast({
          scanned: Number(d.scanned ?? 0),
          fired: Number(d.fired ?? 0),
          failed: d.failed == null ? undefined : Number(d.failed),
          skipped: Number(d.skipped ?? 0),
          dispatched: d.dispatched == null ? undefined : Number(d.dispatched),
          failures: parseFailures(d.failures),
          minDays: typeof d.minDays === "number" ? d.minDays : null,
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
      // Same-origin, cookie-authenticated: the middleware CSRF rule expects JSON.
      const res = await fetch("/api/automation/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `Sweep failed (${res.status})`);
        return;
      }
      setLast({
        scanned: json.scanned,
        fired: json.fired,
        failed: json.failed,
        skipped: json.skipped,
        dispatched: json.dispatched,
        failures: parseFailures(json.failures),
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Distress sweep
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {last ? (
            <>
              Last sweep {fmtDateTime(last.at)} · scanned{" "}
              <span className="tabular-nums text-slate-100">{last.scanned}</span> · fired{" "}
              <span className="tabular-nums text-amber-300">{last.fired}</span>
              {last.failed ? (
                <>
                  {" "}
                  · failed <span className="tabular-nums text-red-300">{last.failed}</span>
                </>
              ) : null}{" "}
              · skipped <span className="tabular-nums text-slate-100">{last.skipped}</span>
              {last.dispatched !== undefined && (
                <>
                  {" "}
                  · dispatched{" "}
                  <span className="tabular-nums text-emerald-300">{last.dispatched}</span>
                </>
              )}
              {last.minDays != null && (
                <span className="text-slate-500"> · threshold {last.minDays}d</span>
              )}
            </>
          ) : (
            "No sweep recorded yet. Scheduled daily at 13:00 UTC via vercel.json; run it now to evaluate distress rules against flagged parcels."
          )}
        </p>
        {last?.failed && last.failures && last.failures.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-xs text-red-300">
            {last.failures.map((f) => {
              const hint = failureHint(f);
              return (
                <li key={f.reason}>
                  failed {f.count} — {f.reason}
                  {hint && <span className="text-slate-400"> ({hint})</span>}
                </li>
              );
            })}
          </ul>
        ) : null}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Run sweep now
      </button>
    </div>
  );
}
