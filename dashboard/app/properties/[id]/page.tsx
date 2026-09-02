import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, MapPin, Radar, StickyNote } from "lucide-react";
import { fetchLead, fetchScans } from "@/lib/data";
import { DISTRESS_THRESHOLD_DAYS } from "@/lib/types";
import { fmtDate, fmtDays } from "@/lib/format";
import { LEAD_STATUS } from "@/lib/ui/status";
import { CompareViewer, DispatchCard, VerificationProvider } from "@/components/CompareViewer";
import { PropertyInsights } from "@/components/property/PropertyInsights";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SetHeaderTitle } from "@/components/shell/HeaderTitle";

export const dynamic = "force-dynamic";

// Shared between generateMetadata and the page within one request.
const getLead = cache(fetchLead);

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const lead = await getLead(params.id);
  return { title: lead?.address ?? "Property" };
}

export default async function PropertyDetail({ params }: { params: { id: string } }) {
  const [lead, scans] = await Promise.all([getLead(params.id), fetchScans(params.id)]);
  if (!lead) notFound();

  const overThreshold = (lead.days_distressed ?? 0) >= DISTRESS_THRESHOLD_DAYS;
  const alreadyDispatched = lead.status === "dispatched";
  const dispatchDisabledReason =
    lead.verification && lead.verification !== "verified_vacant"
      ? `Verdict is ${lead.verification}`
      : null;
  const osmUrl = `https://www.openstreetmap.org/?mlat=${lead.lat}&mlon=${lead.lng}#map=19/${lead.lat}/${lead.lng}`;

  return (
    <VerificationProvider>
      <SetHeaderTitle title={lead.address} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Viewer column */}
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-white md:text-2xl">
                {lead.address}
              </h1>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                APN {lead.parcel_id} · {scans.length} scan{scans.length === 1 ? "" : "s"}
              </p>
            </div>
            <StatusBadge status={LEAD_STATUS[lead.status]} size="md" className="lg:hidden" />
          </div>

          <CompareViewer
            propertyId={lead.id}
            scans={scans}
            alreadyDispatched={alreadyDispatched}
            address={lead.address}
          />
          <PropertyInsights lead={lead} scans={scans} />
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          <section className="panel p-4" aria-labelledby="parcel-title">
            <h2 id="parcel-title" className="panel-title">
              Parcel
            </h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">Status</dt>
                <dd>
                  <StatusBadge status={LEAD_STATUS[lead.status]} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">Days distressed</dt>
                <dd
                  className={
                    overThreshold
                      ? "font-mono font-semibold tabular-nums text-red-300"
                      : "font-mono tabular-nums text-white"
                  }
                  title={
                    lead.first_flagged_at
                      ? `First flagged ${fmtDate(lead.first_flagged_at)}`
                      : undefined
                  }
                >
                  {fmtDays(lead.days_distressed)}
                  {overThreshold && (
                    <span className="ml-1 text-label normal-case tracking-normal text-red-300/80">
                      past {DISTRESS_THRESHOLD_DAYS} d
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">APN</dt>
                <dd className="font-mono text-white">{lead.parcel_id}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="flex items-center gap-1 text-slate-400">
                  <MapPin className="h-3.5 w-3.5" aria-hidden /> Coordinates
                </dt>
                <dd className="text-right font-mono tabular-nums text-white">
                  {lead.lat.toFixed(5)}, {lead.lng.toFixed(5)}
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/operations?focus=${lead.id}`} className="btn-secondary">
                <Radar className="h-3.5 w-3.5" aria-hidden /> Open in Ops map
              </Link>
              <a
                href={osmUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost"
                title="Open in OpenStreetMap"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> OSM
              </a>
            </div>
          </section>

          {lead.notes && (
            <section className="panel p-4" aria-labelledby="notes-title">
              <h2 id="notes-title" className="panel-title flex items-center gap-1.5">
                <StickyNote className="h-3.5 w-3.5" aria-hidden /> Notes
              </h2>
              <p className="mt-2 text-sm text-slate-300">{lead.notes}</p>
            </section>
          )}

          <div className="lg:sticky lg:top-20">
            <DispatchCard
              propertyId={lead.id}
              address={lead.address}
              alreadyDispatched={alreadyDispatched}
              dispatchDisabledReason={dispatchDisabledReason}
            />
          </div>
        </aside>
      </div>
    </VerificationProvider>
  );
}
