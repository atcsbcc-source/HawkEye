import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { fetchLead, fetchScans } from "@/lib/data";
import { DISTRESS_THRESHOLD_DAYS } from "@/lib/types";
import { CompareViewer } from "@/components/CompareViewer";

export const dynamic = "force-dynamic";

export default async function PropertyDetail({
  params,
}: {
  params: { id: string };
}) {
  const [lead, scans] = await Promise.all([
    fetchLead(params.id),
    fetchScans(params.id),
  ]);
  if (!lead) notFound();

  const overThreshold =
    (lead.days_distressed ?? 0) >= DISTRESS_THRESHOLD_DAYS;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Command Center
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">{lead.address}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-400">
            <MapPin className="h-4 w-4" />
            APN {lead.parcel_id} · {lead.lat.toFixed(4)}, {lead.lng.toFixed(4)}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="capitalize text-slate-300">Status: {lead.status}</p>
          {lead.days_distressed !== null && (
            <p className={overThreshold ? "font-semibold text-red-400" : "text-slate-400"}>
              {lead.days_distressed} days distressed
              {overThreshold && " — past dispatch threshold"}
            </p>
          )}
        </div>
      </div>

      {lead.notes && (
        <p className="rounded-lg border border-surface-border bg-surface-raised p-3 text-sm text-slate-300">
          {lead.notes}
        </p>
      )}

      <CompareViewer
        propertyId={lead.id}
        scans={scans}
        alreadyDispatched={lead.status === "dispatched"}
      />
    </div>
  );
}
