"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plane } from "lucide-react";
import { suggestFlightCode } from "./flightCode";

const input =
  "w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-sky-500";

/** Create a flight row before ingesting a sortie. Auto-suggests FLT-YYYY-Www-NEIGHBORHOOD. */
export function FlightForm({
  neighborhoods,
  defaultNeighborhood,
}: {
  neighborhoods: string[];
  defaultNeighborhood?: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [flownAt, setFlownAt] = useState(today);
  const [neighborhood, setNeighborhood] = useState(defaultNeighborhood ?? neighborhoods[0] ?? "Oakwood");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [altitude, setAltitude] = useState("90");
  const [gsd, setGsd] = useState("2.4");
  const [drone, setDrone] = useState("DJI Mavic 3 Classic");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!codeTouched) setCode(suggestFlightCode(flownAt, neighborhood));
  }, [flownAt, neighborhood, codeTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/flights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flight_code: code.trim() || undefined,
          flown_at: new Date(`${flownAt}T12:00:00`).toISOString(),
          neighborhood: neighborhood.trim(),
          drone_model: drone.trim() || undefined,
          altitude_m: altitude ? Number(altitude) : null,
          gsd_cm_per_px: gsd ? Number(gsd) : null,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      setState("idle");
      router.push(`/flights/${json.flight.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-surface-border bg-surface-raised p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">New flight</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Flown on">
          <input type="date" className={input} value={flownAt} onChange={(e) => setFlownAt(e.target.value)} required />
        </Field>
        <Field label="Neighborhood">
          <input
            className={input}
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
            list="hawkeye-flight-neighborhoods"
            required
          />
          <datalist id="hawkeye-flight-neighborhoods">
            {neighborhoods.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="Flight code">
        <input
          className={`${input} font-mono`}
          value={code}
          onChange={(e) => {
            setCodeTouched(true);
            setCode(e.target.value.toUpperCase());
          }}
          placeholder="FLT-2026-W36-OAKWOOD"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Altitude (m AGL)">
          <input className={input} value={altitude} onChange={(e) => setAltitude(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="GSD (cm/px)">
          <input className={input} value={gsd} onChange={(e) => setGsd(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Aircraft">
          <input className={input} value={drone} onChange={(e) => setDrone(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Weather, re-flown parcels…" />
      </Field>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={state === "saving"}
        className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
      >
        {state === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plane className="h-4 w-4" />}
        Create flight
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}
