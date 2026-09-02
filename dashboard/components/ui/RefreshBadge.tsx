"use client";

import clsx from "clsx";
import { fmtTime } from "@/lib/format";

/**
 * Poll-health indicator for client panels: `● LIVE` while requests succeed,
 * `REFRESH FAILED · retrying` (with the last success time) otherwise.
 */
export function RefreshBadge({
  failed,
  lastOk,
  className,
}: {
  failed: boolean;
  lastOk: number | null;
  className?: string;
}) {
  if (!failed) {
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1 font-mono text-label uppercase text-emerald-300",
          className
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        live
      </span>
    );
  }
  return (
    <span
      role="status"
      className={clsx(
        "inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-label uppercase text-red-300",
        className
      )}
      title={lastOk ? `Last successful refresh ${fmtTime(lastOk)}` : "No successful refresh yet"}
    >
      Refresh failed · retrying
      {lastOk && <span className="normal-case text-red-300/80"> · last {fmtTime(lastOk)}</span>}
    </span>
  );
}
