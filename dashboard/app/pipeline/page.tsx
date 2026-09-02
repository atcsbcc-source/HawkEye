import { Suspense } from "react";
import type { Metadata } from "next";
import { fetchLeads } from "@/lib/data";
import { fetchOpenTasks } from "@/lib/crm-data";
import { buildWorkQueue, isClosedStage } from "@/lib/crm";
import { PipelineView } from "@/components/crm/PipelineView";
import { StatCard } from "@/components/StatCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { BellRing, HandCoins, ListTodo, SquareKanban } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline" };

/** Deal pipeline: kanban by stage + the cross-parcel work queue. */
export default function PipelinePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <PipelineBody />
    </Suspense>
  );
}

async function PipelineBody() {
  const [leads, tasks] = await Promise.all([fetchLeads(), fetchOpenTasks()]);
  const queue = buildWorkQueue(leads, tasks);
  const overdue = queue.filter((i) => i.bucket === "overdue").length;
  const today = queue.filter((i) => i.bucket === "today").length;
  const working = leads.filter((l) => l.crm_stage !== "new" && !isClosedStage(l.crm_stage));
  const negotiating = leads.filter(
    (l) => l.crm_stage === "negotiating" || l.crm_stage === "under_contract",
  );
  const won = leads.filter((l) => l.crm_stage === "closed_won").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="In the pipeline"
          value={working.length}
          hint={`${leads.filter((l) => l.crm_stage === "new").length} still new`}
          href="/pipeline"
          icon={<SquareKanban className="h-5 w-5 text-sky-400" aria-hidden />}
        />
        <StatCard
          label="Negotiating / under contract"
          value={negotiating.length}
          hint={`${won} closed won`}
          href="/pipeline"
          icon={<HandCoins className="h-5 w-5 text-cyan-400" aria-hidden />}
        />
        <StatCard
          label="Overdue"
          value={overdue}
          hint="tasks and next actions"
          href="/pipeline?view=queue"
          tone="danger"
          icon={<BellRing className="h-5 w-5 text-red-400" aria-hidden />}
        />
        <StatCard
          label="Due today"
          value={today}
          hint={`${queue.length} open items`}
          href="/pipeline?view=queue"
          tone="warn"
          icon={<ListTodo className="h-5 w-5 text-amber-400" aria-hidden />}
        />
      </div>
      <PipelineView leads={leads} queue={queue} />
    </div>
  );
}
