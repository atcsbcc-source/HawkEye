import Link from "next/link";
import { Pencil } from "lucide-react";
import type { PropertyLead, PropertyScan } from "@/lib/types";
import { fmtFullDate } from "@/lib/format";
import { FactorBreakdown } from "./FactorBreakdown";
import { ScanTimeline } from "./ScanTimeline";
import { VerificationPanel } from "./VerificationPanel";

/**
 * Detail-page block placed under the comparator: scan-history sparklines and
 * the operator verification card. Server component; VerificationPanel is the
 * only interactive child.
 */
export function PropertyInsights({ lead, scans }: { lead: PropertyLead; scans: PropertyScan[] }) {
  const latestScanId = scans[0]?.id ?? null;
  return (
    <div className="space-y-4">
      <FactorBreakdown scan={scans[0]} />
      <ScanTimeline scans={scans} />
      <VerificationPanel lead={lead} latestScanId={latestScanId} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {lead.neighborhood ? `Grid: ${lead.neighborhood}` : "No neighborhood assigned"}
          {lead.snoozed_until && new Date(lead.snoozed_until) > new Date() && (
            <> · auto-flag snoozed until {fmtFullDate(lead.snoozed_until)}</>
          )}
        </span>
        <Link
          href={`/properties/${lead.id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-md border border-surface-border px-2 py-1 text-slate-300 transition hover:border-sky-500/50 hover:text-white"
        >
          <Pencil className="h-3 w-3" /> Edit parcel
        </Link>
      </div>
    </div>
  );
}
