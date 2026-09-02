import type { Metadata } from "next";
import { fetchFlights, fetchNeighborhoods } from "@/lib/data";
import { FlightForm } from "@/components/flights/FlightForm";
import { FlightTable } from "@/components/flights/FlightTable";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Flights" };

export default async function FlightsPage() {
  const [flights, neighborhoods] = await Promise.all([fetchFlights(), fetchNeighborhoods()]);
  const totalScans = flights.reduce((a, f) => a + f.scan_count, 0);
  const totalFlagged = flights.reduce((a, f) => a + f.newly_flagged, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-white">Flights</h2>
          <p className="mt-1 text-sm text-slate-400">
            One row per weekly sortie. Create the flight here first —{" "}
            <code className="text-slate-300">run_pipeline.py</code> looks the code up before it
            writes any scans.
          </p>
        </div>
        <p className="text-xs text-slate-400">
          <span className="tabular-nums text-slate-100">{flights.length}</span> flights ·{" "}
          <span className="tabular-nums text-slate-100">{totalScans}</span> scans ·{" "}
          <span className="tabular-nums text-amber-300">{totalFlagged}</span> newly flagged
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <FlightTable flights={flights} />
        </div>
        <FlightForm neighborhoods={neighborhoods} defaultNeighborhood={flights[0]?.neighborhood} />
      </div>
    </div>
  );
}
