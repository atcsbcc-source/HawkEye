"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { AuditEvent } from "@/lib/ops-types";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { RefreshBadge } from "@/components/ui/RefreshBadge";

/** Every event type ops.ts and the automation layer emit, toned by outcome. */
const TYPE_TONE: Record<string, string> = {
  "mission.created": "text-cyan-300",
  "mission.launched": "text-cyan-300",
  "mission.completed": "text-emerald-300",
  "mission.aborted": "text-red-300",
  "rule.created": "text-sky-300",
  "rule.enabled": "text-slate-300",
  "rule.disabled": "text-slate-400",
  "rule.fired": "text-amber-300",
  "lead.dispatched": "text-emerald-300",
  "property.status_changed": "text-amber-300",
  "property.verified": "text-emerald-300",
  "webhook.delivered": "text-emerald-300",
  "webhook.failed": "text-red-300",
  "automation.sweep": "text-sky-300",
  "scan.processed": "text-slate-300",
};

const SUBJECT_LABEL: Record<string, string> = {
  mission: "Missions",
  rule: "Rules",
  property: "Properties",
  scan: "Scans",
  webhook: "Webhooks",
  flight: "Flights",
};

export function AuditFeed({
  events,
  compact = false,
  pollFailed = false,
  lastOk = null,
}: {
  /** null until the first response. */
  events: AuditEvent[] | null;
  compact?: boolean;
  pollFailed?: boolean;
  lastOk?: number | null;
}) {
  const [filter, setFilter] = useState<string>("all");

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const e of events ?? []) if (e.subjectType) set.add(e.subjectType);
    return Array.from(set).sort();
  }, [events]);

  const groups = useMemo(() => {
    const list = (events ?? []).filter((e) => filter === "all" || e.subjectType === filter);
    const out: { day: string; items: AuditEvent[] }[] = [];
    for (const e of list) {
      const day = fmtDate(e.occurredAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [events, filter]);

  return (
    <section className="panel p-4" aria-labelledby="events-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="events-title" className="panel-title">
          Event stream
        </h2>
        {events !== null && <RefreshBadge failed={pollFailed} lastOk={lastOk} />}
      </div>

      {subjects.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Filter by subject"
          className="mt-2 flex flex-wrap gap-1"
        >
          {["all", ...subjects].map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={filter === s}
              onClick={() => setFilter(s)}
              className={clsx(
                "h-6 rounded-md px-2 font-mono text-label uppercase transition",
                filter === s
                  ? "bg-sky-700 text-white"
                  : "border border-surface-border text-slate-400 hover:text-white"
              )}
            >
              {s === "all" ? "All" : SUBJECT_LABEL[s] ?? s}
            </button>
          ))}
        </div>
      )}

      {events === null ? (
        <SkeletonRows className="mt-3" />
      ) : (
        <ul
          className={clsx(
            "mt-3 overflow-y-auto pr-1",
            compact ? "max-h-56" : "max-h-[28rem] lg:max-h-[calc(100vh-14rem)]"
          )}
        >
          {groups.length === 0 && (
            <li className="py-4 text-center text-xs text-slate-400">
              {events.length === 0
                ? "No events yet — activity from missions, rules, and the pipeline lands here."
                : "No events for this filter."}
            </li>
          )}
          {groups.map((g) => (
            <li key={g.day}>
              <div className="sticky top-0 z-10 -mx-1 bg-surface-raised px-1 py-1 font-mono text-label uppercase text-slate-400">
                {g.day}
              </div>
              <ul>
                {g.items.map((e) => (
                  <li key={e.id} className="border-l border-surface-border py-2 pl-3 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={clsx(
                          "truncate font-mono",
                          TYPE_TONE[e.eventType] ?? "text-slate-300"
                        )}
                      >
                        {e.eventType}
                      </span>
                      <time
                        dateTime={e.occurredAt}
                        title={fmtDateTime(e.occurredAt)}
                        className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400"
                      >
                        {fmtTime(e.occurredAt)}
                      </time>
                    </div>
                    <p className="mt-0.5 break-words text-slate-400">
                      <span className="text-slate-300">{e.actor}</span>
                      {e.subjectType === "property" && e.subjectId && (
                        <>
                          {" · "}
                          <Link
                            href={`/properties/${e.subjectId}`}
                            className="text-sky-300 underline-offset-2 hover:underline"
                          >
                            property {e.subjectId.slice(0, 8)}
                          </Link>
                        </>
                      )}
                      {e.detail && Object.keys(e.detail).length > 0 && (
                        <span className="font-mono text-[11px]">
                          {" · "}
                          {Object.entries(e.detail)
                            .filter(([, v]) => typeof v !== "object")
                            .slice(0, 4)
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(" ")}
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
