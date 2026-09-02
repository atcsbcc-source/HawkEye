import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plane } from "lucide-react";
import { fetchFlight, fetchFlightScans, fetchFlights } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Flight" };

export default async function FlightDetailPage({ params }: { params: { id: string } }) {
  const [flight, scans, all] = await Promise.all([
    fetchFlight(params.id),
    fetchFlightScans(params.id),
    fetchFlights(),
  ]);
  if (!flight) notFound();

  const idx = all.findIndex((f) => f.id === flight.id);
  const previous =
    idx >= 0 ? all.slice(idx + 1).find((f) => f.neighborhood === flight.neighborhood) : undefined;
  const summary = all[idx];
  const gsd = flight.gsd_cm_per_px != null ? Number(flight.gsd_cm_per_px) : 2.5;

  const cropCmd = [
    "python crop_parcels.py",
    `  --ortho data/orthos/${flight.flight_code}.tif`,
    `  --flight-code ${flight.flight_code}`,
    previous ? `  --prev-flight-code ${previous.flight_code}` : null,
    "  --out data",
  ]
    .filter(Boolean)
    .join(" \\\n");
  const pipelineCmd = `python run_pipeline.py --flight-code ${flight.flight_code} --gsd-cm ${gsd} --data-dir data`;

  return (
    <div className="space-y-6">
      <Link
        href="/flights"
        className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> All flights
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-2xl font-semibold text-white">{flight.flight_code}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-400">
            <Plane className="h-4 w-4" />
            {new Date(flight.flown_at).toLocaleDateString(undefined, { dateStyle: "long" })} ·{" "}
            {flight.neighborhood} · {flight.drone_model}
            {flight.altitude_m != null && ` · ${flight.altitude_m} m AGL`}
            {flight.gsd_cm_per_px != null && ` · ${Number(flight.gsd_cm_per_px).toFixed(2)} cm/px`}
          </p>
          {flight.notes && <p className="mt-1 text-sm text-slate-300">{flight.notes}</p>}
        </div>
        {summary && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Scans" value={String(summary.scan_count)} />
            <Stat
              label="Newly flagged"
              value={String(summary.newly_flagged)}
              accent={summary.newly_flagged > 0}
            />
            <Stat
              label="Mean align."
              value={summary.mean_alignment == null ? "—" : summary.mean_alignment.toFixed(2)}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-surface-border bg-surface-raised xl:col-span-2">
          <div className="border-b border-surface-border p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Parcels scanned
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-surface-border">
                  <th className="px-4 py-3">Property</th>
                  <th className="px-4 py-3 text-right">Confidence</th>
                  <th className="px-4 py-3 text-right">Lawn</th>
                  <th className="px-4 py-3 text-right">Change</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3 text-right">Align.</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-surface-border/60 transition hover:bg-surface"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/properties/${s.property_id}`} className="group">
                        <p className="font-medium text-white group-hover:text-sky-400">
                          {s.property?.address ?? s.property_id}
                        </p>
                        {s.property && (
                          <p className="text-xs text-slate-500">
                            APN {s.property.parcel_id} · {s.property.status}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span
                        className={
                          s.vacancy_confidence >= 75
                            ? "font-semibold text-amber-300"
                            : "text-slate-300"
                        }
                      >
                        {s.vacancy_confidence}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                      {s.lawn_growth_index != null ? Number(s.lawn_growth_index).toFixed(2) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                      {s.change_score != null ? `${Number(s.change_score).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {s.vehicle_present ? (s.vehicle_static ? "static" : "present") : "none"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.alignment_quality == null ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <span
                          className={
                            Number(s.alignment_quality) < 0.5 ? "text-red-300" : "text-slate-300"
                          }
                        >
                          {Number(s.alignment_quality).toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {scans.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      No scans ingested for this flight yet — follow the checklist.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-surface-border bg-surface-raised p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            Ingest checklist
          </p>
          <ol className="space-y-3 text-xs text-slate-300">
            <li>
              <p className="text-slate-400">1. Export the stitched ortho as GeoTIFF to</p>
              <code className="block break-all font-mono text-[11px] text-slate-200">
                pipeline/data/orthos/{flight.flight_code}.tif
              </code>
            </li>
            <li>
              <p className="text-slate-400">
                2. Crop every tracked parcel
                {previous
                  ? ` (paired with ${previous.flight_code})`
                  : " (first flight — no previous pairing)"}
              </p>
              <pre className="mt-1 overflow-x-auto rounded-lg border border-surface-border bg-surface p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                {`cd pipeline\n${cropCmd}`}
              </pre>
            </li>
            <li>
              <p className="text-slate-400">3. Score, upload and upsert scans for this flight</p>
              <pre className="mt-1 overflow-x-auto rounded-lg border border-surface-border bg-surface p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                {pipelineCmd}
              </pre>
            </li>
            <li className="text-slate-500">
              4. Refresh this page — scans, newly-flagged and mean alignment update as rows land.
              Then run the distress sweep from{" "}
              <Link href="/automation" className="text-sky-300 hover:underline">
                Automation
              </Link>
              .
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={
          accent
            ? "mt-0.5 text-lg font-semibold tabular-nums text-amber-300"
            : "mt-0.5 text-lg font-semibold tabular-nums text-white"
        }
      >
        {value}
      </p>
    </div>
  );
}
