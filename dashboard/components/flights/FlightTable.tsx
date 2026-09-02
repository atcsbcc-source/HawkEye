import Link from "next/link";
import type { FlightSummary } from "@/lib/types";
import { fmtFullDate } from "@/lib/format";

/** Sortie table for /flights. Server component — data comes from fetchFlights(). */
export function FlightTable({ flights }: { flights: FlightSummary[] }) {
  return (
    <section className="rounded-xl border border-surface-border bg-surface-raised">
      <div className="border-b border-surface-border p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Flights
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr className="border-b border-surface-border">
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Flown</th>
              <th className="px-4 py-3">Neighborhood</th>
              <th className="px-4 py-3">Aircraft</th>
              <th className="px-4 py-3 text-right">Alt (m)</th>
              <th className="px-4 py-3 text-right">GSD</th>
              <th className="px-4 py-3 text-right">Scans</th>
              <th className="px-4 py-3 text-right">Newly flagged</th>
              <th className="px-4 py-3 text-right">Mean align.</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => (
              <tr
                key={f.id}
                className="border-b border-surface-border/60 transition hover:bg-surface"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/flights/${f.id}`}
                    className="font-mono text-white hover:text-sky-400"
                  >
                    {f.flight_code}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-300">{fmtFullDate(f.flown_at)}</td>
                <td className="px-4 py-3 text-slate-300">{f.neighborhood}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{f.drone_model}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {f.altitude_m ?? "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                  {f.gsd_cm_per_px != null ? `${Number(f.gsd_cm_per_px).toFixed(2)} cm` : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">{f.scan_count}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <span
                    className={
                      f.newly_flagged > 0 ? "font-semibold text-amber-300" : "text-slate-400"
                    }
                  >
                    {f.newly_flagged}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {f.mean_alignment == null ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <span className={f.mean_alignment < 0.5 ? "text-red-300" : "text-slate-300"}>
                      {f.mean_alignment.toFixed(2)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {flights.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  No flights yet. Create one before running the pipeline — and see
                  docs/FIRST_FLIGHT.md for the sortie checklist.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
