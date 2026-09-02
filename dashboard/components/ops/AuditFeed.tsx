"use client";

import clsx from "clsx";
import type { AuditEvent } from "@/lib/ops-types";

const TYPE_TONE: Record<string, string> = {
  "mission.launched": "text-sky-300",
  "mission.completed": "text-emerald-300",
  "mission.aborted": "text-red-300",
  "rule.fired": "text-amber-300",
  "property.status_changed": "text-amber-300",
  "scan.processed": "text-slate-300",
};

export function AuditFeed({
  events,
  compact = false,
}: {
  events: AuditEvent[];
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
        Event stream
      </p>
      <ul
        className={clsx(
          "mt-3 space-y-0 overflow-y-auto",
          compact ? "max-h-56" : "max-h-[28rem]"
        )}
      >
        {events.length === 0 && (
          <li className="py-4 text-center text-xs text-slate-500">
            No events yet — activity from missions, rules, and the pipeline
            lands here.
          </li>
        )}
        {events.map((e) => (
          <li
            key={e.id}
            className="border-l border-surface-border py-2 pl-3 text-xs"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className={clsx("font-mono", TYPE_TONE[e.eventType] ?? "text-slate-300")}>
                {e.eventType}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-slate-500">
                {new Date(e.occurredAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>
            <p className="mt-0.5 text-slate-400">
              <span className="text-slate-500">{e.actor}</span>
              {e.detail && Object.keys(e.detail).length > 0 && (
                <span>
                  {" · "}
                  {Object.entries(e.detail)
                    .filter(([, v]) => typeof v !== "object")
                    .slice(0, 3)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(" ")}
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
