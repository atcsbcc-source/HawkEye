"use client";

import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ListTodo, SquareKanban } from "lucide-react";
import type { WorkItem } from "@/lib/crm";
import type { PropertyLead } from "@/lib/types";
import { PipelineBoard } from "./PipelineBoard";
import { WorkQueue } from "./WorkQueue";

type View = "board" | "queue";

/** `?view=board|queue` tab switch above the board / work queue. */
export function PipelineView({ leads, queue }: { leads: PropertyLead[]; queue: WorkItem[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const view: View = sp.get("view") === "queue" ? "queue" : "board";
  const due = queue.filter((i) => i.bucket === "overdue" || i.bucket === "today").length;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Pipeline views"
        className="flex w-fit gap-1 rounded-lg border border-surface-border p-1"
      >
        {(
          [
            ["board", "Board", SquareKanban, null],
            ["queue", "Work queue", ListTodo, due],
          ] as const
        ).map(([id, label, Icon, badge]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={view === id}
            onClick={() =>
              router.replace(id === "board" ? "/pipeline" : "/pipeline?view=queue", {
                scroll: false,
              })
            }
            className={clsx(
              "inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs transition",
              view === id ? "bg-sky-700 text-white" : "text-slate-400 hover:text-white",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
            {badge != null && badge > 0 && (
              <span className="rounded-full bg-red-500/20 px-1.5 font-mono text-[10px] text-red-300">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {view === "board" ? <PipelineBoard leads={leads} /> : <WorkQueue items={queue} />}
    </div>
  );
}
