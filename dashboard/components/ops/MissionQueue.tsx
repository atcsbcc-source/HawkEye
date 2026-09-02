"use client";

import clsx from "clsx";
import { OctagonX, Play, Plus } from "lucide-react";
import type { Mission } from "@/lib/ops-types";

const STATUS_STYLE: Record<string, string> = {
  queued: "text-slate-300 border-slate-500/40",
  active: "text-amber-300 border-amber-500/40",
  completed: "text-emerald-300 border-emerald-500/40",
  aborted: "text-red-300 border-red-500/40",
};

export function MissionQueue({
  missions,
  busy,
  onCreate,
  onAction,
}: {
  missions: Mission[];
  busy: boolean;
  onCreate: () => void;
  onAction: (id: string, action: "launch" | "abort") => void;
}) {
  const hasActive = missions.some((m) => m.status === "active");

  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Mission tasking
        </p>
        <button
          onClick={onCreate}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-sky-500/50 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> NEW GRID MISSION
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {missions.length === 0 && (
          <li className="py-4 text-center text-xs text-slate-500">
            No missions tasked. Create a grid mission over the AO.
          </li>
        )}
        {missions.slice(0, 6).map((m) => (
          <li
            key={m.id}
            className="rounded-lg border border-surface-border bg-surface px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{m.name}</p>
                <p className="font-mono text-[10px] text-slate-500">
                  {m.id.slice(0, 8)} ·{" "}
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {m.droneSerial ? ` · ${m.droneSerial}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={clsx(
                    "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                    STATUS_STYLE[m.status]
                  )}
                >
                  {m.status}
                </span>
                {m.status === "queued" && (
                  <button
                    title={hasActive ? "Aircraft busy" : "Launch"}
                    disabled={busy || hasActive}
                    onClick={() => onAction(m.id, "launch")}
                    className="rounded-md border border-emerald-500/50 p-1 text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}
                {m.status === "active" && (
                  <button
                    title="Abort / RTB"
                    disabled={busy}
                    onClick={() => onAction(m.id, "abort")}
                    className="rounded-md border border-red-500/50 p-1 text-red-300 transition hover:bg-red-500/10 disabled:opacity-40"
                  >
                    <OctagonX className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            {m.status === "active" && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${m.progress}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
