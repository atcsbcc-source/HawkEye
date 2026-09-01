import { AlertTriangle, Building2, Send, Timer } from "lucide-react";
import { fetchLeads } from "@/lib/data";
import { DISTRESS_THRESHOLD_DAYS } from "@/lib/types";
import { PropertyGrid } from "@/components/PropertyGrid";
import { StatCard } from "@/components/StatCard";

export const dynamic = "force-dynamic";

export default async function CommandCenter() {
  const leads = await fetchLeads();

  const flagged = leads.filter((l) => l.status === "flagged");
  const overThreshold = flagged.filter(
    (l) => (l.days_distressed ?? 0) >= DISTRESS_THRESHOLD_DAYS
  );
  const dispatched = leads.filter((l) => l.status === "dispatched");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Tracked parcels"
          value={leads.length}
          icon={<Building2 className="h-5 w-5 text-sky-400" />}
        />
        <StatCard
          label="Flagged distressed"
          value={flagged.length}
          icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
        />
        <StatCard
          label={`Over ${DISTRESS_THRESHOLD_DAYS}-day threshold`}
          value={overThreshold.length}
          icon={<Timer className="h-5 w-5 text-red-400" />}
          accent
        />
        <StatCard
          label="Dispatched to CRM"
          value={dispatched.length}
          icon={<Send className="h-5 w-5 text-emerald-400" />}
        />
      </div>

      <PropertyGrid leads={leads} />
    </div>
  );
}
