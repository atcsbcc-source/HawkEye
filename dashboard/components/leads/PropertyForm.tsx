"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Archive, Loader2, Save } from "lucide-react";
import type { Property } from "@/lib/types";

const input =
  "w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-sky-500";

type Values = {
  parcel_id: string;
  address: string;
  lat: string;
  lng: string;
  neighborhood: string;
  notes: string;
};

/**
 * Create / edit form for a tracked parcel. Posts JSON to /api/properties
 * (create) or PATCHes /api/properties/[id] (edit); server `error` strings are
 * shown inline. Status text is plain inline copy — no toast dependency.
 */
export function PropertyForm({
  initial,
  neighborhoods = [],
}: {
  initial?: Property;
  neighborhoods?: string[];
}) {
  const router = useRouter();
  const editing = Boolean(initial);
  const [values, setValues] = useState<Values>({
    parcel_id: initial?.parcel_id ?? "",
    address: initial?.address ?? "",
    lat: initial ? String(initial.lat) : "",
    lng: initial ? String(initial.lng) : "",
    neighborhood: initial?.neighborhood ?? "",
    notes: initial?.notes ?? "",
  });
  const [state, setState] = useState<"idle" | "saving" | "archiving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  function localErrors(): string | null {
    if (!editing && !values.parcel_id.trim()) return "Parcel ID is required.";
    if (!values.address.trim()) return "Address is required.";
    const lat = Number(values.lat);
    const lng = Number(values.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return "Latitude must be between -90 and 90.";
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return "Longitude must be between -180 and 180.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local = localErrors();
    if (local) {
      setError(local);
      setState("error");
      return;
    }
    setState("saving");
    setError(null);
    const payload: Record<string, unknown> = {
      address: values.address.trim(),
      lat: Number(values.lat),
      lng: Number(values.lng),
      neighborhood: values.neighborhood.trim() || null,
      notes: values.notes.trim() || null,
    };
    if (!editing) payload.parcel_id = values.parcel_id.trim();
    try {
      const res = await fetch(editing ? `/api/properties/${initial!.id}` : "/api/properties", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      setState("saved");
      const id = json.property?.id ?? initial?.id;
      router.push(id ? `/properties/${id}` : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  }

  async function archive() {
    if (!initial) return;
    if (!window.confirm(`Archive ${initial.address}? It disappears from the grid but keeps its scans.`)) return;
    setState("archiving");
    setError(null);
    try {
      const res = await fetch(`/api/properties/${initial.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        setState("error");
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setState("error");
    }
  }

  const busy = state === "saving" || state === "archiving";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-surface-border bg-surface-raised p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parcel ID (APN)">
          <input
            className={clsx(input, editing && "opacity-60")}
            value={values.parcel_id}
            onChange={set("parcel_id")}
            placeholder="042-115-008"
            disabled={editing}
            required={!editing}
          />
        </Field>
        <Field label="Neighborhood / grid">
          <input
            className={input}
            value={values.neighborhood}
            onChange={set("neighborhood")}
            placeholder="Oakwood"
            list="hawkeye-neighborhoods"
          />
          {neighborhoods.length > 0 && (
            <datalist id="hawkeye-neighborhoods">
              {neighborhoods.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
        </Field>
      </div>
      <Field label="Address">
        <input className={input} value={values.address} onChange={set("address")} placeholder="1418 Ashwood Ct" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Latitude">
          <input className={input} value={values.lat} onChange={set("lat")} placeholder="35.2271" inputMode="decimal" required />
        </Field>
        <Field label="Longitude">
          <input className={input} value={values.lng} onChange={set("lng")} placeholder="-80.8431" inputMode="decimal" required />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={clsx(input, "min-h-[80px]")} value={values.notes} onChange={set("notes")} placeholder="Owner contact, access notes…" />
      </Field>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {state === "saved" && <p className="text-xs text-emerald-300">Saved.</p>}

      <div className="flex items-center justify-between gap-3">
        {editing ? (
          <button
            type="button"
            onClick={archive}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            {state === "archiving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
            Archive property
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
        >
          {state === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {editing ? "Save changes" : "Add property"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}
