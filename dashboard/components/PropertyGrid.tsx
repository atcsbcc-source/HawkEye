"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Car, Filter, Search, Sprout } from "lucide-react";
import { DISTRESS_THRESHOLD_DAYS, type LeadStatus, type PropertyLead } from "@/lib/types";
import { ConfidenceBar } from "./ConfidenceBar";

const STATUS_STYLE: Record<LeadStatus, string> = {
  active: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  flagged: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  dispatched: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export function PropertyGrid({ leads }: { leads: PropertyLead[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [overThresholdOnly, setOverThresholdOnly] = useState(false);

  const rows = useMemo(() => {
    return leads
      .filter((l) => status === "all" || l.status === status)
      .filter(
        (l) =>
          !overThresholdOnly ||
          (l.days_distressed ?? 0) >= DISTRESS_THRESHOLD_DAYS
      )
      .filter((l) => {
        const q = query.trim().toLowerCase();
        return (
          !q ||
          l.address.toLowerCase().includes(q) ||
          l.parcel_id.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          (b.latest_vacancy_confidence ?? -1) - (a.latest_vacancy_confidence ?? -1)
      );
  }, [leads, query, status, overThresholdOnly]);

  return (
    <section className="rounded-xl border border-surface-border bg-surface-raised">
      <div className="flex flex-wrap items-center gap-3 border-b border-surface-border p-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Address or parcel ID…"
            className="w-56 rounded-lg border border-surface-border bg-surface py-2 pl-8 pr-3 text-sm outline-none placeholder:text-slate-500 focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-surface-border p-1">
          {(["all", "active", "flagged", "dispatched"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-xs capitalize transition",
                status === s
                  ? "bg-sky-600 text-white"
                  : "text-slate-400 hover:text-white"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          onClick={() => setOverThresholdOnly((v) => !v)}
          className={clsx(
            "ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition",
            overThresholdOnly
              ? "border-red-500/50 bg-red-500/10 text-red-300"
              : "border-surface-border text-slate-400 hover:text-white"
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          {DISTRESS_THRESHOLD_DAYS}+ days distressed
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr className="border-b border-surface-border">
              <th className="px-4 py-3">Property</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Days distressed</th>
              <th className="px-4 py-3">Vacancy confidence</th>
              <th className="px-4 py-3">Signals</th>
              <th className="px-4 py-3">Last scan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr
                key={l.id}
                className="border-b border-surface-border/60 transition hover:bg-surface"
              >
                <td className="px-4 py-3">
                  <Link href={`/properties/${l.id}`} className="group">
                    <p className="font-medium text-white group-hover:text-sky-400">
                      {l.address}
                    </p>
                    <p className="text-xs text-slate-500">APN {l.parcel_id}</p>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={clsx(
                      "rounded-full border px-2 py-0.5 text-xs capitalize",
                      STATUS_STYLE[l.status]
                    )}
                  >
                    {l.status}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {l.days_distressed === null ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <span
                      className={clsx(
                        l.days_distressed >= DISTRESS_THRESHOLD_DAYS &&
                          "font-semibold text-red-400"
                      )}
                    >
                      {l.days_distressed}d
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ConfidenceBar value={l.latest_vacancy_confidence} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 text-slate-400">
                    {(l.latest_lawn_growth_index ?? 0) > 0.1 && (
                      <span title="Lawn overgrowth">
                        <Sprout className="h-4 w-4 text-lime-400" />
                      </span>
                    )}
                    {l.latest_vehicle_present && (
                      <span title="Vehicle on parcel">
                        <Car className="h-4 w-4 text-sky-400" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {l.latest_scan_at
                    ? new Date(l.latest_scan_at).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No properties match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
