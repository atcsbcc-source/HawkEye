import Link from "next/link";
import clsx from "clsx";
import { TrendingDown, TrendingUp } from "lucide-react";

export type StatTone = "default" | "warn" | "danger";

/**
 * Dashboard stat tile. `tone="danger"` only tints the left border, and only
 * while `value` is a positive number — a zero count should never read as an
 * error. With `href` the whole card becomes a link to a filtered grid.
 */
export function StatCard({
  label,
  value,
  hint,
  delta,
  href,
  tone = "default",
  icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  delta?: { value: number; label: string };
  href?: string;
  tone?: StatTone;
  icon?: React.ReactNode;
}) {
  const hot = typeof value === "number" ? value > 0 : Boolean(value);
  const toneClass =
    tone === "danger" && hot
      ? "border-l-2 border-l-red-500"
      : tone === "warn" && hot
        ? "border-l-2 border-l-amber-400"
        : "";

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="kicker truncate">{label}</p>
        {icon && <span className="shrink-0">{icon}</span>}
      </div>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums text-white md:text-3xl">
        {value}
      </p>
      {(hint || delta) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
          {hint && <span className="truncate">{hint}</span>}
          {delta && (
            <span
              className={clsx(
                "inline-flex items-center gap-1 font-mono text-[11px]",
                delta.value >= 0 ? "text-emerald-300" : "text-red-300"
              )}
            >
              {delta.value >= 0 ? (
                <TrendingUp className="h-3 w-3" aria-hidden />
              ) : (
                <TrendingDown className="h-3 w-3" aria-hidden />
              )}
              {delta.value > 0 ? "+" : ""}
              {delta.value} {delta.label}
            </span>
          )}
        </div>
      )}
    </>
  );

  const base = clsx("panel block min-w-0 p-4", toneClass);

  if (href) {
    return (
      <Link
        href={href}
        className={clsx(base, "transition-colors hover:border-slate-500/60 hover:bg-surface-hover")}
      >
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}
