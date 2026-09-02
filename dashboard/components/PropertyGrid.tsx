"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ArrowUpDown, Car, Filter, Search, Sprout, X } from "lucide-react";
import { DISTRESS_THRESHOLD_DAYS, type LeadStatus, type PropertyLead } from "@/lib/types";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { useNow } from "@/lib/ui/useNow";
import { LEAD_STATUS } from "@/lib/ui/status";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfidenceBar } from "./ConfidenceBar";

const STATUS_FILTERS = ["all", "active", "flagged", "dispatched"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

type SortKey = "address" | "status" | "days" | "confidence" | "lgi" | "last_scan";
type SortDir = "asc" | "desc";

const LGI_SIGNAL = 0.1;
const STALE_SCAN_MS = 14 * 86_400_000;

const COLUMNS: { key: SortKey; label: string; className?: string; numeric?: boolean }[] = [
  { key: "address", label: "Property" },
  { key: "status", label: "Status" },
  { key: "days", label: "Days distressed", className: "hidden sm:table-cell", numeric: true },
  { key: "confidence", label: "Vacancy confidence", numeric: true },
  { key: "lgi", label: "Signals", className: "hidden md:table-cell" },
  { key: "last_scan", label: "Last scan", className: "hidden md:table-cell" },
];

function parseStatus(v: string | null): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(v ?? "") ? (v as StatusFilter) : "all";
}

const num = (v: number | null | undefined) => (v == null ? -Infinity : v);
const ts = (v: string | null | undefined) => (v ? Date.parse(v) : -Infinity);

function compare(a: PropertyLead, b: PropertyLead, key: SortKey): number {
  switch (key) {
    case "address":
      return a.address.localeCompare(b.address);
    case "status":
      return LEAD_STATUS[a.status].label.localeCompare(LEAD_STATUS[b.status].label);
    case "days":
      return num(a.days_distressed) - num(b.days_distressed);
    case "confidence":
      return num(a.latest_vacancy_confidence) - num(b.latest_vacancy_confidence);
    case "lgi":
      return num(a.latest_lawn_growth_index) - num(b.latest_lawn_growth_index);
    case "last_scan":
      return ts(a.latest_scan_at) - ts(b.latest_scan_at);
  }
}

export function PropertyGrid({
  leads,
  source = "mock",
}: {
  leads: PropertyLead[];
  source?: "mock" | "supabase";
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const sp = useSearchParams();
  const now = useNow(60_000);

  // URL is the source of truth for status/over; the search box is local and
  // syncs to the URL (debounced, without a server round-trip).
  const status = parseStatus(sp.get("status"));
  const over = sp.get("over") === "1";
  const [query, setQuery] = useState(sp.get("q") ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("confidence");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const buildUrl = useCallback(
    (s: StatusFilter, o: boolean, q: string) => {
      const p = new URLSearchParams();
      if (s !== "all") p.set("status", s);
      if (o) p.set("over", "1");
      if (q.trim()) p.set("q", q.trim());
      const qs = p.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname]
  );

  const setStatus = (s: StatusFilter) =>
    router.replace(buildUrl(s, over, query), { scroll: false });
  const setOver = (o: boolean) => router.replace(buildUrl(status, o, query), { scroll: false });
  const clearFilters = () => {
    setQuery("");
    router.replace(pathname, { scroll: false });
  };

  useEffect(() => {
    const current = sp.get("q") ?? "";
    if (current === query.trim()) return;
    const t = setTimeout(() => {
      window.history.replaceState(null, "", buildUrl(status, over, query));
    }, 300);
    return () => clearTimeout(t);
  }, [query, status, over, sp, buildUrl]);

  const filtersActive = status !== "all" || over || query.trim().length > 0;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = leads
      .filter((l) => status === "all" || l.status === status)
      .filter((l) => !over || (l.days_distressed ?? 0) >= DISTRESS_THRESHOLD_DAYS)
      .filter(
        (l) =>
          !q || l.address.toLowerCase().includes(q) || l.parcel_id.toLowerCase().includes(q)
      );
    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const primary = compare(a, b, sortKey) * dir;
      if (primary !== 0) return primary;
      // Tiebreak: confidence desc, then days desc.
      const c = compare(b, a, "confidence");
      return c !== 0 ? c : compare(b, a, "days");
    });
  }, [leads, query, status, over, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "address" || key === "status" ? "asc" : "desc");
    }
  }

  return (
    <section className="panel" aria-labelledby="grid-title">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-border p-4 md:gap-3">
        <h2 id="grid-title" className="sr-only">
          Tracked parcels
        </h2>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Address or parcel ID…"
            aria-label="Search address or parcel ID"
            className="input w-full pl-8 sm:w-56"
          />
        </div>

        <div
          role="radiogroup"
          aria-label="Status"
          className="flex h-9 items-center gap-1 rounded-lg border border-surface-border p-1"
        >
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => setStatus(s)}
              className={clsx(
                "h-7 rounded-md px-2.5 text-xs capitalize transition",
                status === s ? "bg-sky-700 text-white" : "text-slate-400 hover:text-white"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOver(!over)}
          aria-pressed={over}
          className={clsx(
            "btn h-9 gap-2 border px-3 text-xs",
            over
              ? "border-red-500/50 bg-red-500/10 text-red-300"
              : "border-surface-border text-slate-400 hover:text-white"
          )}
        >
          <Filter className="h-3.5 w-3.5" aria-hidden />
          {DISTRESS_THRESHOLD_DAYS}+ days distressed
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-slate-400" aria-live="polite">
            {rows.length}/{leads.length} parcels
          </span>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="btn-ghost h-7 px-2">
              <X className="h-3.5 w-3.5" aria-hidden /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[calc(100vh-22rem)] min-h-[12rem] overflow-auto">
        <table className="w-full text-left text-sm" aria-label="Tracked parcels">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              {COLUMNS.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                    className={clsx(
                      "sticky top-0 z-10 border-b border-surface-border bg-surface-raised/95 px-3 py-2.5 font-medium backdrop-blur",
                      c.className
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={clsx(
                        "inline-flex items-center gap-1 rounded uppercase tracking-wide transition hover:text-slate-200",
                        active && "text-white"
                      )}
                    >
                      {c.label}
                      <ArrowUpDown
                        className={clsx("h-3 w-3", active ? "text-sky-400" : "text-slate-500")}
                        aria-hidden
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const href = `/properties/${l.id}`;
              const overThreshold =
                l.days_distressed !== null && l.days_distressed >= DISTRESS_THRESHOLD_DAYS;
              const scanMs = l.latest_scan_at ? Date.parse(l.latest_scan_at) : null;
              const staleScan = now !== null && scanMs !== null && now - scanMs > STALE_SCAN_MS;
              const lgi = l.latest_lawn_growth_index;
              return (
                <tr
                  key={l.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button")) return;
                    router.push(href);
                  }}
                  className="h-12 cursor-pointer border-b border-surface-border/60 transition hover:bg-surface-hover"
                >
                  <td className="relative px-3 py-2.5">
                    <Link
                      href={href}
                      className="font-medium text-white after:absolute after:inset-0 hover:text-sky-300"
                    >
                      {l.address}
                    </Link>
                    <p className="font-mono text-[11px] text-slate-400">APN {l.parcel_id}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={LEAD_STATUS[l.status]} />
                  </td>
                  <td className="hidden px-3 py-2.5 font-mono tabular-nums sm:table-cell">
                    {l.days_distressed === null ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <span className={clsx(overThreshold && "font-semibold text-red-300")}>
                        {l.days_distressed} d
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <ConfidenceBar value={l.latest_vacancy_confidence} />
                  </td>
                  <td className="hidden px-3 py-2.5 md:table-cell">
                    <div className="flex items-center gap-3 text-slate-400">
                      {lgi != null && lgi > LGI_SIGNAL && (
                        <span
                          role="img"
                          aria-label={`Lawn overgrowth, lawn growth index ${lgi.toFixed(2)}`}
                          title={`Lawn growth index ${lgi.toFixed(2)} (signal above ${LGI_SIGNAL})`}
                          className="inline-flex items-center gap-1"
                        >
                          <Sprout className="h-4 w-4 text-lime-400" aria-hidden />
                          <span className="font-mono text-[11px]">LGI {lgi.toFixed(2)}</span>
                        </span>
                      )}
                      {l.latest_vehicle_present && (
                        <span role="img" aria-label="Vehicle on parcel" title="Vehicle on parcel">
                          <Car className="h-4 w-4 text-sky-400" aria-hidden />
                        </span>
                      )}
                      {!(lgi != null && lgi > LGI_SIGNAL) && !l.latest_vehicle_present && (
                        <span className="text-slate-500">—</span>
                      )}
                    </div>
                  </td>
                  <td
                    className={clsx(
                      "hidden px-3 py-2.5 text-xs md:table-cell",
                      staleScan ? "text-red-300" : "text-slate-400"
                    )}
                    title={l.latest_scan_at ? fmtDateTime(l.latest_scan_at) : undefined}
                    suppressHydrationWarning
                  >
                    {l.latest_scan_at
                      ? now === null
                        ? fmtDate(l.latest_scan_at)
                        : fmtRelative(l.latest_scan_at, now)
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-sm">
                  <EmptyState
                    leads={leads.length}
                    filtersActive={filtersActive}
                    source={source}
                    onClear={clearFilters}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-border px-4 py-2 font-mono text-[11px] text-slate-400">
        <span className="uppercase tracking-[0.14em]">Signals</span>
        <span className="inline-flex items-center gap-1">
          <Sprout className="h-3.5 w-3.5 text-lime-400" aria-hidden /> lawn growth index &gt;{" "}
          {LGI_SIGNAL.toFixed(2)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Car className="h-3.5 w-3.5 text-sky-400" aria-hidden /> vehicle on parcel
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-px bg-slate-300/70" aria-hidden /> auto-flag tick at
          75
        </span>
      </div>
    </section>
  );
}

function EmptyState({
  leads,
  filtersActive,
  source,
  onClear,
}: {
  leads: number;
  filtersActive: boolean;
  source: "mock" | "supabase";
  onClear: () => void;
}) {
  if (leads > 0 && filtersActive) {
    return (
      <div className="space-y-3 text-slate-400">
        <p>No parcels match the current filters.</p>
        <button type="button" onClick={onClear} className="btn-secondary">
          <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
        </button>
      </div>
    );
  }
  if (source === "supabase") {
    return (
      <div className="mx-auto max-w-md space-y-1 text-slate-300">
        <p className="font-medium text-white">0 parcels tracked</p>
        <p className="text-slate-400">
          Reads require an authenticated session — sign in, or seed the{" "}
          <code className="rounded bg-surface px-1 font-mono text-[11px]">properties</code> table.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md space-y-1 text-slate-300">
      <p className="font-medium text-white">Mock mode has no parcels</p>
      <p className="text-slate-400">
        Set <code className="rounded bg-surface px-1 font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
        to read live data, or restore the sample leads in <code className="font-mono text-[11px]">lib/mock.ts</code>.
      </p>
    </div>
  );
}
