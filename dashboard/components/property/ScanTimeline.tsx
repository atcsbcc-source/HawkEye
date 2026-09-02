import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { PropertyScan } from "@/lib/types";
import { AUTO_FLAG_CONFIDENCE } from "@/lib/constants";

interface Series {
  key: string;
  label: string;
  values: (number | null)[];
  min: number;
  max: number;
  reference?: number;
  color: string;
  format: (v: number) => string;
}

function lowAlignment(s: PropertyScan): boolean {
  const details = (s.raw_metrics as { details?: { low_alignment?: unknown } } | null | undefined)
    ?.details;
  if (details && typeof details.low_alignment === "boolean") return details.low_alignment;
  return s.alignment_quality != null && s.alignment_quality < 0.5;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Dependency-free inline-SVG sparklines per flight (x = flown_at) for the
 * four signals the operator actually reasons about, plus a summary strip.
 * Hollow points mark frames the pipeline flagged as low alignment.
 */
export function ScanTimeline({ scans }: { scans: PropertyScan[] }) {
  // Oldest -> newest along x.
  const ordered = [...scans].sort((a, b) =>
    (a.flight?.flown_at ?? a.processed_at).localeCompare(b.flight?.flown_at ?? b.processed_at),
  );
  if (ordered.length === 0) return null;

  const hollow = ordered.map(lowAlignment);
  const series: Series[] = [
    {
      key: "confidence",
      label: "Vacancy confidence",
      values: ordered.map((s) => s.vacancy_confidence),
      min: 0,
      max: 100,
      reference: AUTO_FLAG_CONFIDENCE,
      color: "#fbbf24",
      format: (v) => `${Math.round(v)}`,
    },
    {
      key: "lawn",
      label: "Lawn growth index",
      values: ordered.map((s) => s.lawn_growth_index),
      min: -1,
      max: 1,
      reference: 0,
      color: "#a3e635",
      format: (v) => v.toFixed(2),
    },
    {
      key: "change",
      label: "Change score",
      values: ordered.map((s) => s.change_score),
      min: 0,
      max: Math.max(10, ...ordered.map((s) => s.change_score ?? 0)),
      color: "#38bdf8",
      format: (v) => `${v.toFixed(1)}%`,
    },
    {
      key: "alignment",
      label: "Alignment quality",
      values: ordered.map((s) => s.alignment_quality),
      min: 0,
      max: 1,
      reference: 0.5,
      color: "#c4b5fd",
      format: (v) => v.toFixed(2),
    },
  ];

  const conf = ordered.map((s) => s.vacancy_confidence);
  const weeksOver = conf.filter((c) => c >= AUTO_FLAG_CONFIDENCE).length;
  const recent = mean(conf.slice(-3));
  const prior = mean(conf.slice(-6, -3));
  const trend = recent != null && prior != null ? recent - prior : null;

  return (
    <section className="space-y-4 rounded-xl border border-surface-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Scan history
        </p>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span>
            <span className="tabular-nums text-slate-100">{ordered.length}</span> weeks observed
          </span>
          <span>
            <span
              className={
                weeksOver > 0 ? "tabular-nums text-amber-300" : "tabular-nums text-slate-100"
              }
            >
              {weeksOver}
            </span>{" "}
            over threshold
          </span>
          <span className="flex items-center gap-1">
            Trend
            {trend === null ? (
              <span className="text-slate-500">— (need 4+ weeks)</span>
            ) : trend > 3 ? (
              <span className="flex items-center text-red-300">
                <ArrowUpRight className="h-3.5 w-3.5" /> +{trend.toFixed(0)}
              </span>
            ) : trend < -3 ? (
              <span className="flex items-center text-emerald-300">
                <ArrowDownRight className="h-3.5 w-3.5" /> {trend.toFixed(0)}
              </span>
            ) : (
              <span className="flex items-center text-slate-300">
                <ArrowRight className="h-3.5 w-3.5" /> flat
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {series.map((s) => (
          <Sparkline
            key={s.key}
            series={s}
            hollow={hollow}
            labels={ordered.map((o) => o.flight?.flight_code ?? "")}
          />
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        Hollow points: low alignment frame (score is unreliable). Dashed line: auto-flag threshold /
        zero line.
      </p>
    </section>
  );
}

function Sparkline({
  series,
  hollow,
  labels,
}: {
  series: Series;
  hollow: boolean[];
  labels: string[];
}) {
  const W = 260;
  const H = 64;
  const padX = 8;
  const padY = 6;
  const n = series.values.length;
  const x = (i: number) => (n === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1));
  const y = (v: number) => {
    const clamped = Math.max(series.min, Math.min(series.max, v));
    return padY + (H - 2 * padY) * (1 - (clamped - series.min) / (series.max - series.min || 1));
  };
  const points = series.values
    .map((v, i) => (v == null ? null : ([x(i), y(v), i] as const)))
    .filter((p): p is readonly [number, number, number] => p !== null);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const latest = [...series.values].reverse().find((v) => v != null) ?? null;

  return (
    <div className="rounded-lg border border-surface-border bg-surface p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-label uppercase text-slate-400">{series.label}</p>
        <p className="text-sm font-semibold tabular-nums text-white">
          {latest == null ? "—" : series.format(latest)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 h-16 w-full"
        role="img"
        aria-label={`${series.label} over time`}
      >
        {series.reference !== undefined && (
          <line
            x1={0}
            x2={W}
            y1={y(series.reference)}
            y2={y(series.reference)}
            stroke="#64748b"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
        )}
        {points.length > 1 && <path d={path} fill="none" stroke={series.color} strokeWidth={1.5} />}
        {points.map((p) => (
          <circle
            key={p[2]}
            cx={p[0]}
            cy={p[1]}
            r={3}
            fill={hollow[p[2]] ? "#0f172a" : series.color}
            stroke={series.color}
            strokeWidth={1.5}
          >
            {/* One string child: React's server renderer drops <title> content
                when its children are an array, which then fails hydration. */}
            <title>
              {`${labels[p[2]] || `Scan ${p[2] + 1}`}: ${series.format(
                series.values[p[2]] as number,
              )}${hollow[p[2]] ? " (low alignment)" : ""}`}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
