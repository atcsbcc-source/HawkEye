import { Suspense } from "react";
import { AlertTriangle, Building2, ListTodo, Plane, Send, Timer } from "lucide-react";
import { fetchLeads } from "@/lib/data";
import { fetchOpenTasks } from "@/lib/crm-data";
import { buildWorkQueue } from "@/lib/crm";
import { DISTRESS_THRESHOLD_DAYS } from "@/lib/types";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { PropertyGrid } from "@/components/PropertyGrid";
import { StatCard } from "@/components/StatCard";
import { LeadActions } from "@/components/leads/LeadActions";
import { CommandCenterSkeleton } from "@/components/ui/PageSkeletons";

export const dynamic = "force-dynamic";
// Title falls back to the layout default ("HawkEye Command Center"): Next only
// applies `title.template` to child segments, not the root page itself.

/**
 * The skeleton is an in-page Suspense fallback rather than app/loading.tsx: a
 * root loading.tsx would wrap every route and stream a 200 shell before
 * dynamic pages can answer 404 (see components/ui/PageSkeletons.tsx).
 */
export default function CommandCenter() {
  return (
    <Suspense fallback={<CommandCenterSkeleton />}>
      <CommandCenterBody />
    </Suspense>
  );
}

async function CommandCenterBody() {
  const [leads, tasks] = await Promise.all([fetchLeads(), fetchOpenTasks()]);
  const queue = buildWorkQueue(leads, tasks);
  const dueNow = queue.filter((i) => i.bucket === "overdue" || i.bucket === "today");
  const overdue = dueNow.filter((i) => i.bucket === "overdue").length;
  const source = process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "mock";

  const flagged = leads.filter((l) => l.status === "flagged");
  const overThreshold = flagged.filter((l) => (l.days_distressed ?? 0) >= DISTRESS_THRESHOLD_DAYS);
  const dispatched = leads.filter((l) => l.status === "dispatched");
  const scanned = leads.filter((l) => l.latest_scan_at !== null).length;

  const lastScanAt = leads.reduce<string | null>((max, l) => {
    if (!l.latest_scan_at) return max;
    return !max || l.latest_scan_at > max ? l.latest_scan_at : max;
  }, null);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Tracked parcels"
          value={leads.length}
          hint={`${scanned} with imagery`}
          href="/"
          icon={<Building2 className="h-5 w-5 text-sky-400" aria-hidden />}
        />
        <StatCard
          label="Flagged distressed"
          value={flagged.length}
          hint={`${flagged.length} of ${leads.length} tracked`}
          href="/?status=flagged"
          tone="warn"
          icon={<AlertTriangle className="h-5 w-5 text-amber-400" aria-hidden />}
        />
        <StatCard
          label={`Over ${DISTRESS_THRESHOLD_DAYS}-day threshold`}
          value={overThreshold.length}
          hint="ready to dispatch"
          href="/?status=flagged&over=1"
          tone="danger"
          icon={<Timer className="h-5 w-5 text-red-400" aria-hidden />}
        />
        <StatCard
          label="Dispatched to CRM"
          value={dispatched.length}
          hint="handed off"
          href="/?status=dispatched"
          icon={<Send className="h-5 w-5 text-emerald-400" aria-hidden />}
        />
        <StatCard
          label="Due today"
          value={dueNow.length}
          hint={overdue ? `${overdue} overdue` : `${queue.length} open items`}
          href="/pipeline?view=queue"
          tone={overdue ? "danger" : "warn"}
          icon={<ListTodo className="h-5 w-5 text-amber-400" aria-hidden />}
        />
        <StatCard
          label="Last flight"
          value={lastScanAt ? fmtRelative(lastScanAt) : "—"}
          hint={lastScanAt ? fmtDateTime(lastScanAt) : "no scans processed"}
          href="/operations"
          icon={<Plane className="h-5 w-5 text-cyan-400" aria-hidden />}
        />
      </div>

      <LeadActions />
      <PropertyGrid leads={leads} source={source} />
    </div>
  );
}
