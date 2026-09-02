import clsx from "clsx";

export type CellTone = "default" | "warn" | "danger" | "muted";

const VALUE_TONE: Record<CellTone, string> = {
  default: "text-white",
  warn: "text-amber-300",
  danger: "text-red-300",
  muted: "text-slate-400",
};

const BAR_TONE = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  danger: "bg-red-400",
  info: "bg-cyan-400",
} as const;

/**
 * Metric cell shared by the telemetry rail and the property comparator:
 * icon + kicker label + mono value, optional 4px bar underneath.
 */
export function Cell({
  icon,
  label,
  value,
  tone = "default",
  bar,
  title,
  dim = false,
  className,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  tone?: CellTone;
  /** 4px bar under the value; `pct` is clamped to 0–100. */
  bar?: { pct: number; tone: keyof typeof BAR_TONE };
  title?: string;
  /** Greys the cell out (telemetry not live). */
  dim?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      title={title}
      className={clsx(
        "min-w-0 rounded-lg border border-surface-border bg-surface px-2 py-1.5 transition",
        dim && "opacity-60 grayscale",
        className
      )}
    >
      <div className="kicker flex items-center gap-1 normal-case tracking-[0.14em]">
        {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
        <span className="truncate uppercase">{label}</span>
      </div>
      {value !== undefined && (
        <p className={clsx("truncate font-mono text-sm tabular-nums", VALUE_TONE[tone])}>
          {value}
        </p>
      )}
      {children}
      {bar && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-700" aria-hidden>
          <div
            className={clsx("h-full transition-all", BAR_TONE[bar.tone])}
            style={{ width: `${Math.max(0, Math.min(100, bar.pct))}%` }}
          />
        </div>
      )}
    </div>
  );
}
