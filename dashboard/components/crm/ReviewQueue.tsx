"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  CheckCircle2,
  CircleSlash,
  Home,
  Keyboard,
  Loader2,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { CompareViewer, VerificationProvider } from "@/components/CompareViewer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { apiJson } from "@/lib/ui/api";
import { LEAD_STATUS } from "@/lib/ui/status";
import {
  VERDICT_LABEL,
  type PropertyLead,
  type PropertyScan,
  type VerificationVerdict,
} from "@/lib/types";

export interface ReviewItem {
  lead: PropertyLead;
  scans: PropertyScan[];
}

const KEYS: {
  key: string;
  verdict: VerificationVerdict;
  icon: typeof CheckCircle2;
  tone: string;
}[] = [
  {
    key: "v",
    verdict: "verified_vacant",
    icon: CheckCircle2,
    tone: "border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10",
  },
  {
    key: "f",
    verdict: "false_positive",
    icon: CircleSlash,
    tone: "border-red-500/50 text-red-300 hover:bg-red-500/10",
  },
  {
    key: "o",
    verdict: "occupied",
    icon: Home,
    tone: "border-amber-500/50 text-amber-300 hover:bg-amber-500/10",
  },
  {
    key: "r",
    verdict: "needs_recheck",
    icon: RotateCcw,
    tone: "border-sky-500/50 text-sky-300 hover:bg-sky-500/10",
  },
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable);

/**
 * Keyboard-driven verification queue: J/K (or arrows) move through the
 * flagged parcels that still need a verdict, V/F/O/R record one and advance,
 * N focuses the note. Each verdict goes through the same POST as the
 * property page, so workflow rules (verified → pipeline, skip-trace task) fire.
 */
export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [idx, setIdx] = useState(0);
  const [decided, setDecided] = useState<Record<string, VerificationVerdict>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);

  const current = items[idx];
  const remaining = items.filter((i) => !decided[i.lead.id]).length;

  const go = useCallback(
    (delta: number) => setIdx((i) => Math.min(items.length - 1, Math.max(0, i + delta))),
    [items.length],
  );

  const record = useCallback(
    async (verdict: VerificationVerdict) => {
      if (!current || busy) return;
      setBusy(true);
      try {
        const res = await apiJson<{ automation?: { fired: string[] } }>(
          `/api/properties/${current.lead.id}/verify`,
          {
            method: "POST",
            body: JSON.stringify({
              verdict,
              note: note.trim() || null,
              scanId: current.scans[0]?.id ?? null,
            }),
          },
        );
        setDecided((d) => ({ ...d, [current.lead.id]: verdict }));
        setNote("");
        const fired = res.automation?.fired?.length ?? 0;
        toast.success(
          `${current.lead.address}: ${VERDICT_LABEL[verdict]}${fired ? ` · ${fired} rule${fired === 1 ? "" : "s"} fired` : ""}`,
        );
        // Advance to the next undecided parcel after this one (wrap once).
        const order = [...items.slice(idx + 1), ...items.slice(0, idx)];
        const next = order.find((i) => !decided[i.lead.id] && i.lead.id !== current.lead.id);
        if (next) setIdx(items.indexOf(next));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not record the verdict");
      } finally {
        setBusy(false);
      }
    },
    [current, busy, note, items, idx, decided, router, toast],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (k === "k" || e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (k === "n") {
        e.preventDefault();
        noteRef.current?.focus();
      } else {
        const hit = KEYS.find((x) => x.key === k);
        if (hit) {
          e.preventDefault();
          record(hit.verdict);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, record]);

  if (items.length === 0) {
    return (
      <section className="panel p-10 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" aria-hidden />
        <p className="mt-3 text-sm text-white">Review queue is clear</p>
        <p className="mt-1 text-xs text-slate-400">
          Every flagged parcel has a verdict. New flags land here after the next flight is
          processed.
        </p>
        <Link href="/pipeline" className="btn-secondary mt-4">
          Open the pipeline
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Queue list */}
      <aside className="panel flex max-h-[calc(100vh-10rem)] flex-col">
        <div className="flex items-center justify-between border-b border-surface-border p-3">
          <span className="panel-title">Queue</span>
          <span className="font-mono text-[11px] text-slate-400">{remaining} left</span>
        </div>
        <ol className="flex-1 overflow-auto p-2">
          {items.map((it, i) => {
            const v = decided[it.lead.id];
            return (
              <li key={it.lead.id}>
                <button
                  type="button"
                  onClick={() => setIdx(i)}
                  aria-current={i === idx ? "true" : undefined}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                    i === idx
                      ? "bg-sky-500/10 text-white"
                      : "text-slate-300 hover:bg-surface-hover",
                    v && "opacity-60",
                  )}
                >
                  <span className="w-7 shrink-0 font-mono text-[11px] text-slate-400">
                    {it.lead.latest_vacancy_confidence ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.lead.address}</span>
                  {v && (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-surface-border p-3 text-[11px] leading-relaxed text-slate-400">
          <p className="mb-1 inline-flex items-center gap-1 text-slate-300">
            <Keyboard className="h-3.5 w-3.5" aria-hidden /> Shortcuts
          </p>
          <p>
            <kbd className="rounded bg-surface px-1">J</kbd>/
            <kbd className="rounded bg-surface px-1">K</kbd> next / previous ·{" "}
            <kbd className="rounded bg-surface px-1">V</kbd> vacant ·{" "}
            <kbd className="rounded bg-surface px-1">F</kbd> false positive ·{" "}
            <kbd className="rounded bg-surface px-1">O</kbd> occupied ·{" "}
            <kbd className="rounded bg-surface px-1">R</kbd> recheck ·{" "}
            <kbd className="rounded bg-surface px-1">N</kbd> note
          </p>
        </div>
      </aside>

      {/* Current parcel */}
      {current && (
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/properties/${current.lead.id}`}
                className="block truncate text-xl font-semibold text-white hover:text-sky-300"
              >
                {current.lead.address}
              </Link>
              <p className="font-mono text-[11px] text-slate-400">
                APN {current.lead.parcel_id} · {idx + 1} / {items.length}
                {current.lead.days_distressed != null &&
                  ` · ${current.lead.days_distressed} d distressed`}
                {current.lead.verification &&
                  ` · currently ${VERDICT_LABEL[current.lead.verification]}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={LEAD_STATUS[current.lead.status]} />
              <button
                type="button"
                className="btn-ghost h-8"
                onClick={() => go(-1)}
                disabled={idx === 0}
                aria-label="Previous"
              >
                <SkipBack className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                className="btn-ghost h-8"
                onClick={() => go(1)}
                disabled={idx === items.length - 1}
                aria-label="Next"
              >
                <SkipForward className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>

          <VerificationProvider>
            <CompareViewer
              key={current.lead.id}
              propertyId={current.lead.id}
              scans={current.scans}
              alreadyDispatched={current.lead.status === "dispatched"}
              address={current.lead.address}
            />
          </VerificationProvider>

          <div className="panel space-y-3 p-4">
            <div className="grid gap-2 sm:grid-cols-4">
              {KEYS.map(({ key, verdict, icon: Icon, tone }) => (
                <button
                  key={verdict}
                  type="button"
                  disabled={busy}
                  onClick={() => record(verdict)}
                  className={clsx(
                    "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition disabled:opacity-50",
                    tone,
                    decided[current.lead.id] === verdict &&
                      "bg-white/5 ring-1 ring-inset ring-current",
                  )}
                >
                  <span className="inline-flex items-center gap-2 font-medium">
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Icon className="h-4 w-4" aria-hidden />
                    )}
                    {VERDICT_LABEL[verdict]}
                  </span>
                  <kbd className="rounded bg-surface px-1.5 font-mono text-[10px] uppercase text-slate-400">
                    {key}
                  </kbd>
                </button>
              ))}
            </div>
            <input
              ref={noteRef}
              className="input h-8 text-xs"
              placeholder="Optional verdict note (N to focus, Esc to leave)…"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
