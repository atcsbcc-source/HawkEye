"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CheckSquare, Clock, Loader2, Square } from "lucide-react";
import { BUCKET_LABEL, BUCKET_ORDER, type DueBucket, type WorkItem } from "@/lib/crm";
import { fmtDateTime } from "@/lib/format";
import { apiJson } from "@/lib/ui/api";
import { CRM_STAGE } from "@/lib/ui/status";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";

const BUCKET_TONE: Record<DueBucket, string> = {
  overdue: "text-red-300",
  today: "text-amber-300",
  week: "text-sky-300",
  later: "text-slate-300",
  unscheduled: "text-slate-500",
};

/**
 * Everything that needs a human today: open tasks and each parcel's next
 * action, grouped overdue → today → this week → later. Completing a task
 * PATCHes the activity; clearing a next action PATCHes the parcel; snoozing
 * pushes the due date.
 */
export function WorkQueue({ items }: { items: WorkItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");

  const assignees = useMemo(
    () => Array.from(new Set(items.map((i) => i.assignedTo).filter(Boolean) as string[])).sort(),
    [items],
  );
  const visible = items.filter(
    (i) => !done.has(`${i.kind}:${i.id}`) && (!assignee || i.assignedTo === assignee),
  );
  const groups = BUCKET_ORDER.map((b) => ({
    bucket: b,
    items: visible.filter((i) => i.bucket === b),
  })).filter((g) => g.items.length > 0);

  async function complete(item: WorkItem) {
    const key = `${item.kind}:${item.id}`;
    setBusy(key);
    try {
      if (item.kind === "task") {
        await apiJson(`/api/properties/${item.propertyId}/activities/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ completed: true }),
        });
      } else {
        await apiJson(`/api/properties/${item.propertyId}`, {
          method: "PATCH",
          body: JSON.stringify({ next_action: null, next_action_at: null }),
        });
      }
      setDone((d) => new Set(d).add(key));
      toast.success("Done");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }

  async function snooze(item: WorkItem, days: number) {
    const key = `${item.kind}:${item.id}`;
    setBusy(key);
    const base = item.dueAt ? Math.max(Date.parse(item.dueAt), Date.now()) : Date.now();
    const next = new Date(base + days * 86_400_000).toISOString();
    try {
      if (item.kind === "task") {
        await apiJson(`/api/properties/${item.propertyId}/activities/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ due_at: next }),
        });
      } else {
        await apiJson(`/api/properties/${item.propertyId}`, {
          method: "PATCH",
          body: JSON.stringify({ next_action_at: next }),
        });
      }
      toast.info(`Snoozed ${days} day${days === 1 ? "" : "s"}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not snooze");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel" aria-labelledby="queue-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border p-4">
        <h2 id="queue-title" className="panel-title">
          Work queue
        </h2>
        <div className="flex items-center gap-2">
          {assignees.length > 0 && (
            <select
              className="input h-8 w-auto text-xs"
              aria-label="Assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Everyone</option>
              {assignees.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          <span className="font-mono text-[11px] text-slate-400">{visible.length} open</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400">
          Queue is clear — nothing due. Open a task or set a next action from any parcel.
        </p>
      ) : (
        <div className="divide-y divide-surface-border/60">
          {groups.map((g) => (
            <div key={g.bucket} className="p-4">
              <p className={clsx("kicker mb-2", BUCKET_TONE[g.bucket])}>
                {BUCKET_LABEL[g.bucket]} · {g.items.length}
              </p>
              <ul className="space-y-1.5">
                {g.items.map((item) => {
                  const key = `${item.kind}:${item.id}`;
                  return (
                    <li
                      key={key}
                      className="flex items-start gap-3 rounded-lg border border-surface-border/60 bg-surface px-3 py-2"
                    >
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-300"
                        aria-label="Mark done"
                        disabled={busy === key}
                        onClick={() => complete(item)}
                      >
                        {busy === key ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : done.has(key) ? (
                          <CheckSquare className="h-4 w-4" aria-hidden />
                        ) : (
                          <Square className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-100">{item.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                          <Link
                            href={`/properties/${item.propertyId}`}
                            className="font-medium text-white hover:text-sky-300"
                          >
                            {item.address}
                          </Link>
                          <StatusBadge status={CRM_STAGE[item.stage]} dot={false} />
                          {item.assignedTo && <span>· {item.assignedTo}</span>}
                          {item.priority === "high" && (
                            <span className="text-red-300">· high priority</span>
                          )}
                          {item.dueAt && (
                            <span
                              className={clsx(
                                "inline-flex items-center gap-1",
                                BUCKET_TONE[item.bucket],
                              )}
                            >
                              <Clock className="h-3 w-3" aria-hidden /> {fmtDateTime(item.dueAt)}
                            </span>
                          )}
                          <span className="text-slate-500">
                            · {item.kind === "task" ? "task" : "next action"}
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className="btn-ghost h-7 px-2"
                          disabled={busy === key}
                          onClick={() => snooze(item, 1)}
                          title="Push one day"
                        >
                          +1d
                        </button>
                        <button
                          type="button"
                          className="btn-ghost h-7 px-2"
                          disabled={busy === key}
                          onClick={() => snooze(item, 7)}
                          title="Push one week"
                        >
                          +7d
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
