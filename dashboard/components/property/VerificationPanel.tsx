"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { CheckCircle2, CircleSlash, Home, Loader2, RotateCcw } from "lucide-react";
import type { PropertyLead, PropertyVerification, VerificationVerdict } from "@/lib/types";

const VERDICTS: {
  value: VerificationVerdict;
  label: string;
  hint: string;
  icon: typeof CheckCircle2;
  tone: string;
  demotes: boolean;
}[] = [
  {
    value: "verified_vacant",
    label: "Verified vacant",
    hint: "Imagery confirms the parcel is unoccupied — clears it for dispatch.",
    icon: CheckCircle2,
    tone: "border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10",
    demotes: false,
  },
  {
    value: "false_positive",
    label: "False positive",
    hint: "Detector fired on noise (vacation, lawn service lapse). Demotes to active and snoozes re-flagging for 8 weeks.",
    icon: CircleSlash,
    tone: "border-red-500/50 text-red-300 hover:bg-red-500/10",
    demotes: true,
  },
  {
    value: "occupied",
    label: "Occupied",
    hint: "Someone lives here. Demotes to active and snoozes re-flagging for 8 weeks.",
    icon: Home,
    tone: "border-amber-500/50 text-amber-300 hover:bg-amber-500/10",
    demotes: true,
  },
  {
    value: "needs_recheck",
    label: "Needs recheck",
    hint: "Inconclusive — keep flagged and look again after the next flight.",
    icon: RotateCcw,
    tone: "border-sky-500/50 text-sky-300 hover:bg-sky-500/10",
    demotes: false,
  },
];

export const VERDICT_LABEL: Record<VerificationVerdict, string> = {
  verified_vacant: "Verified vacant",
  false_positive: "False positive",
  occupied: "Occupied",
  needs_recheck: "Needs recheck",
};

/**
 * Operator verdict card: four verdict buttons (confirm before demoting),
 * autosaving notes (debounced PATCH) and the verification history.
 */
export function VerificationPanel({
  lead,
  latestScanId,
}: {
  lead: PropertyLead;
  latestScanId: string | null;
}) {
  const router = useRouter();
  const [history, setHistory] = useState<PropertyVerification[] | null>(null);
  const [current, setCurrent] = useState<VerificationVerdict | null>(lead.verification ?? null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(lead.verified_at ?? null);
  const [busy, setBusy] = useState<VerificationVerdict | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [note, setNote] = useState("");

  const [notes, setNotes] = useState(lead.notes ?? "");
  const [notesState, setNotesState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(lead.notes ?? "");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/properties/${lead.id}/verify`)
      .then((r) => r.json())
      .then((j) => !cancelled && setHistory(j.verifications ?? []))
      .catch(() => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  // Debounced notes autosave.
  useEffect(() => {
    if (notes === lastSaved.current) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      setNotesState("saving");
      try {
        const res = await fetch(`/api/properties/${lead.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notes.trim() || null }),
        });
        if (!res.ok) throw new Error(String(res.status));
        lastSaved.current = notes;
        setNotesState("saved");
      } catch {
        setNotesState("error");
      }
    }, 800);
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
  }, [notes, lead.id]);

  async function record(v: (typeof VERDICTS)[number]) {
    if (v.demotes && lead.status !== "active") {
      const ok = window.confirm(
        `${v.label}: this returns ${lead.address} to ACTIVE, resets its distress clock and snoozes auto-flagging for 8 weeks. Continue?`,
      );
      if (!ok) return;
    }
    setBusy(v.value);
    setMessage(null);
    try {
      const res = await fetch(`/api/properties/${lead.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: v.value, note: note.trim() || null, scanId: latestScanId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "err", text: json.error ?? `Request failed (${res.status})` });
        return;
      }
      setCurrent(v.value);
      setVerifiedAt(json.verification?.created_at ?? new Date().toISOString());
      setHistory((h) => [json.verification, ...(h ?? [])]);
      setNote("");
      setMessage({
        tone: "ok",
        text: v.demotes
          ? `Recorded ${v.label.toLowerCase()} — parcel returned to active.`
          : `Recorded ${v.label.toLowerCase()}.`,
      });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-surface-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Verification
        </p>
        <p className="text-xs text-slate-400">
          {current ? (
            <>
              Current verdict: <span className="text-slate-100">{VERDICT_LABEL[current]}</span>
              {verifiedAt && (
                <span className="text-slate-500"> · {new Date(verifiedAt).toLocaleString()}</span>
              )}
            </>
          ) : (
            "No verdict yet"
          )}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {VERDICTS.map((v) => {
          const Icon = v.icon;
          const active = current === v.value;
          return (
            <button
              key={v.value}
              type="button"
              title={v.hint}
              disabled={busy !== null}
              onClick={() => record(v)}
              className={clsx(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition disabled:opacity-50",
                v.tone,
                active && "bg-white/5 ring-1 ring-inset ring-current",
              )}
            >
              {busy === v.value ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Icon className="h-4 w-4 shrink-0" />
              )}
              <span className="font-medium">{v.label}</span>
            </button>
          );
        })}
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional verdict note (stored with the verification)…"
        className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs outline-none placeholder:text-slate-500 focus:border-sky-500"
        maxLength={2000}
      />

      {message && (
        <p className={clsx("text-xs", message.tone === "ok" ? "text-emerald-300" : "text-red-400")}>
          {message.text}
        </p>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
            Property notes
          </span>
          <span className="text-[10px] text-slate-500">
            {notesState === "saving" && "Saving…"}
            {notesState === "saved" && "Saved"}
            {notesState === "error" && <span className="text-red-400">Save failed</span>}
          </span>
        </div>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesState("idle");
          }}
          placeholder="Owner contact, access, skip-trace status… autosaves."
          className="min-h-[72px] w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-sky-500"
          maxLength={2000}
        />
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">History</p>
        <ul className="mt-2 space-y-1.5">
          {history === null && <li className="text-xs text-slate-500">Loading…</li>}
          {history?.length === 0 && (
            <li className="text-xs text-slate-500">No verdicts recorded for this parcel.</li>
          )}
          {history?.map((h) => (
            <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
              <span className="font-mono text-[10px] text-slate-500">
                {new Date(h.created_at).toLocaleString()}
              </span>
              <span className="text-slate-100">{VERDICT_LABEL[h.verdict]}</span>
              {h.verified_by && <span className="text-slate-500">by {h.verified_by}</span>}
              {h.note && <span className="text-slate-400">— {h.note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
