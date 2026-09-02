import { AlertTriangle, Building2, Plane, Send, Timer } from "lucide-react";
import { fetchLeads } from "@/lib/data";
import { DISTRESS_THRESHOLD_DAYS } from "@/lib/types";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { PropertyGrid } from "@/components/PropertyGrid";
import { StatCard } from "@/components/StatCard";
import { LeadActions } from "@/components/leads/LeadActions";

export const dynamic = "force-dynamic";
// Title falls back to the layout default ("HawkEye Command Center"): Next only
// applies `title.template` to child segments, not the root page itself.

export default async function CommandCenter() {
  const leads = await fetchLeads();
  const source = process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "mock";

  const flagged = leads.filter((l) => l.status === "flagged");
  const overThreshold = flagged.filter(
    (l) => (l.days_distressed ?? 0) >= DISTRESS_THRESHOLD_DAYS
  );
  const dispatched = leads.filter((l) => l.status === "dispatched");
  const scanned = leads.filter((l) => l.latest_scan_at !== null).length;

  const lastScanAt = leads.reduce<string | null>((max, l) => {
    if (!l.latest_scan_at) return max;
    return !max || l.latest_scan_at > max ? l.latest_scan_at : max;
  }, null);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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
