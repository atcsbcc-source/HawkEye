import clsx from "clsx";
import { AUTO_FLAG_CONFIDENCE, CONFIDENCE_WARN } from "@/lib/constants";

// Thresholds mirror the pipeline's auto-flag rule and review band.
const FLAG_THRESHOLD = AUTO_FLAG_CONFIDENCE;
const REVIEW_THRESHOLD = CONFIDENCE_WARN;

/**
 * Vacancy-confidence meter (0–100) with the auto-flag tick at 75.
 * Red ≥ 75 (auto-flag), amber ≥ 50 (review), emerald below.
 */
export function ConfidenceBar({
  value,
  size = "sm",
  showValue = true,
  label = "Vacancy confidence",
  className,
}: {
  value: number | null;
  size?: "sm" | "lg";
  showValue?: boolean;
  label?: string;
  className?: string;
}) {
  if (value === null) {
    return <span className="text-xs text-slate-500">no scan</span>;
  }
  const v = Math.max(0, Math.min(100, value));
  const tone =
    v >= FLAG_THRESHOLD ? "bg-red-500" : v >= REVIEW_THRESHOLD ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div className={clsx("flex items-center gap-2", size === "lg" && "w-full", className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-valuetext={`${v} of 100${v >= FLAG_THRESHOLD ? ", above auto-flag threshold" : ""}`}
        className={clsx(
          "relative overflow-hidden rounded-full bg-slate-700",
          size === "sm" ? "h-1.5 w-20" : "h-2 w-full",
        )}
      >
        <div className={clsx("h-full", tone)} style={{ width: `${v}%` }} />
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-slate-300/70"
          style={{ left: `${FLAG_THRESHOLD}%` }}
          title={`Auto-flag threshold ${FLAG_THRESHOLD}`}
        />
      </div>
      {showValue && (
        <span
          className={clsx(
            "shrink-0 text-right font-mono tabular-nums",
            size === "sm" ? "w-7 text-xs text-slate-300" : "text-sm text-white",
          )}
        >
          {Math.round(v)}
        </span>
      )}
    </div>
  );
}
