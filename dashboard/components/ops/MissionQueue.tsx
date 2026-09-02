"use client";

import { useState } from "react";
import { ChevronDown, Loader2, OctagonX, Play, Plus } from "lucide-react";
import type { Mission } from "@/lib/ops-types";
import { MISSION_STATUS } from "@/lib/ui/status";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { useNow } from "@/lib/ui/useNow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { RefreshBadge } from "@/components/ui/RefreshBadge";

const VISIBLE = 6;

export function MissionQueue({
  missions,
  pendingId,
  creating = false,
  onCreate,
  onAction,
  pollFailed = false,
  lastOk = null,
}: {
  /** null until the first response. */
  missions: Mission[] | null;
  /** Mission id with an in-flight launch/abort request. */
  pendingId: string | null;
  creating?: boolean;
  onCreate: () => void;
  onAction: (id: string, action: "launch" | "abort") => void;
  pollFailed?: boolean;
  lastOk?: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const now = useNow(30_000);
  const list = missions ?? [];
  const hasActive = list.some((m) => m.status === "active");
  const active = list.filter((m) => m.status === "active").length;
  const queued = list.filter((m) => m.status === "queued").length;
  const shown = expanded ? list : list.slice(0, VISIBLE);
  const hidden = list.length - shown.length;

  return (
    <section className="panel p-4" aria-labelledby="missions-title">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="missions-title" className="panel-title">
            Mission tasking
          </h2>
          <p className="mt-0.5 font-mono text-label uppercase text-slate-400">
            {missions === null ? "loading" : `${active} active · ${queued} queued`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pollFailed && <RefreshBadge failed lastOk={lastOk} />}
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="btn-secondary border-sky-500/50 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"
          >
            {creating ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-3 w-3" aria-hidden />
            )}
            New grid mission
          </button>
        </div>
      </div>

      {missions === null ? (
        <SkeletonRows className="mt-3" />
      ) : (
        <ul className="mt-3 space-y-2">
          {list.length === 0 && (
            <li className="py-4 text-center text-xs text-slate-400">
              No missions tasked. Create a grid mission over the AO.
            </li>
          )}
          {shown.map((m) => {
            const pending = pendingId === m.id;
            return (
              <li
                key={m.id}
                className="rounded-lg border border-surface-border bg-surface px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{m.name}</p>
                    <p
                      className="font-mono text-[11px] text-slate-400"
                      title={fmtDateTime(m.createdAt)}
                      suppressHydrationWarning
                    >
                      {m.id.slice(0, 8)} ·{" "}
                      {now === null ? fmtDate(m.createdAt) : fmtRelative(m.createdAt, now)}
                      {m.droneSerial ? ` · ${m.droneSerial}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge
                      status={MISSION_STATUS[m.status]}
                      pulse={m.status === "active"}
                      label={MISSION_STATUS[m.status].label.toUpperCase()}
                      className="font-mono text-label tracking-wider"
                    />
                    <div className="flex items-center gap-1" data-mission-actions>
                      {m.status === "queued" && (
                        <button
                          type="button"
                          title={hasActive ? "Aircraft busy" : `Launch ${m.name}`}
                          aria-label={`Launch mission ${m.name}`}
                          disabled={pending || hasActive}
                          onClick={() => onAction(m.id, "launch")}
                          className="btn h-7 gap-1 border border-emerald-500/50 px-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                        >
                          {pending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Play className="h-3.5 w-3.5" aria-hidden />
                          )}
                          <span className="hidden xl:inline">Launch</span>
                        </button>
                      )}
                      {m.status === "active" && (
                        <button
                          type="button"
                          title="Abort and return to base"
                          aria-label={`Abort mission ${m.name} and return to base`}
                          disabled={pending}
                          onClick={() => onAction(m.id, "abort")}
                          className="btn h-7 gap-1 border border-red-500/50 px-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                        >
                          {pending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <OctagonX className="h-3.5 w-3.5" aria-hidden />
                          )}
                          <span className="hidden xl:inline">RTB</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {m.status === "active" && (
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className="h-1 flex-1 overflow-hidden rounded-full bg-slate-700"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(m.progress)}
                      aria-label={`${m.name} progress`}
                    >
                      <div
                        className="h-full bg-cyan-400 transition-all"
                        style={{ width: `${m.progress}%` }}
                      />
                    </div>
                    <span className="w-9 text-right font-mono text-[11px] tabular-nums text-cyan-200">
                      {m.progress.toFixed(0)}%
                    </span>
                  </div>
                )}
              </li>
            );
          })}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="btn-ghost w-full"
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden /> +{hidden} more
              </button>
            </li>
          )}
          {expanded && list.length > VISIBLE && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="btn-ghost w-full"
              >
                <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden /> Show fewer
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
