"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  Car,
  CheckCircle2,
  Crosshair,
  Loader2,
  MoveHorizontal,
  RefreshCw,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Sprout,
  TrendingUp,
} from "lucide-react";
import type { PropertyScan } from "@/lib/types";
import { fmtDate, fmtDateTime, fmtPct } from "@/lib/format";
import { Cell } from "@/components/ui/Cell";
import { useToast } from "@/components/ui/Toast";
import { ConfidenceBar } from "./ConfidenceBar";

type Mode = "swipe" | "side" | "diff";
const MODES: { id: Mode; label: string }[] = [
  { id: "swipe", label: "Swipe" },
  { id: "side", label: "Side-by-side" },
  { id: "diff", label: "Diff" },
];

// ---------------------------------------------------------------------------
// Verification context: lets the detail page place <DispatchCard> in its right
// rail while the viewer owns which scan is selected. Without a provider the
// viewer renders the dispatch card inline.
// ---------------------------------------------------------------------------
interface VerificationState {
  scanId: string | null;
  setScanId: (id: string | null) => void;
}
const VerificationCtx = createContext<VerificationState | null>(null);

export function VerificationProvider({ children }: { children: React.ReactNode }) {
  const [scanId, setScanId] = useState<string | null>(null);
  const api = useMemo(() => ({ scanId, setScanId }), [scanId]);
  return <VerificationCtx.Provider value={api}>{children}</VerificationCtx.Provider>;
}

// ---------------------------------------------------------------------------

function weekTag(code: string | undefined): string | null {
  const m = code?.match(/W(\d{1,2})/i);
  return m ? `W${m[1]}` : null;
}

function chipLabel(s: PropertyScan): string {
  const w = weekTag(s.flight?.flight_code);
  const d = fmtDate(s.flight?.flown_at ?? s.processed_at);
  return w ? `${w} · ${d}` : d;
}

function alignTone(q: number | null): "default" | "warn" | "danger" | "muted" {
  if (q == null) return "muted";
  if (q < 0.4) return "danger";
  if (q < 0.6) return "warn";
  return "default";
}

/**
 * Verification comparator: Swipe / Side-by-side / Diff over baseline vs the
 * selected week, with the metric cells and (optionally inline) the CRM
 * dispatch action.
 */
export function CompareViewer({
  propertyId,
  scans,
  alreadyDispatched,
  address,
  dispatchDisabledReason = null,
}: {
  propertyId: string;
  scans: PropertyScan[]; // newest first
  alreadyDispatched: boolean;
  address?: string;
  /** When set, the dispatch button is disabled and the reason is shown. */
  dispatchDisabledReason?: string | null;
}) {
  const ctx = useContext(VerificationCtx);
  const [scanIdx, setScanIdx] = useState(0);
  const [split, setSplit] = useState(50);
  const [mode, setMode] = useState<Mode>("swipe");
  const [diffOpacity, setDiffOpacity] = useState(70);

  const selected: PropertyScan | undefined = scans[scanIdx];
  const selectedId = selected?.id ?? null;
  const setScanId = ctx?.setScanId;
  useEffect(() => {
    setScanId?.(selectedId);
  }, [selectedId, setScanId]);

  if (scans.length === 0 || !selected) {
    return (
      <p className="panel p-6 text-sm text-slate-400">
        No scans yet for this property — it will appear after the next flight is processed.
      </p>
    );
  }

  // Baseline = the oldest "previous" crop we have (not necessarily Week 1).
  const oldest = scans[scans.length - 1];
  const baselineUrl = oldest.image_url_previous ?? oldest.image_url_current;
  const baselineWeek = weekTag(oldest.flight?.flight_code);
  const baselineLabel = oldest.flight
    ? `${oldest.flight.flight_code} · baseline`
    : "Baseline";
  const baselineShort = `BASELINE${baselineWeek ? ` · ${baselineWeek}` : ""} · ${fmtDate(
    oldest.flight?.flown_at ?? oldest.processed_at
  )}`;
  const selectedShort = chipLabel(selected).toUpperCase();
  const diffAvailable = Boolean(selected.image_url_diff);
  const effectiveMode: Mode = mode === "diff" && !diffAvailable ? "swipe" : mode;

  function onSliderKey(e: KeyboardEvent<HTMLInputElement>) {
    let next: number | null = null;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 100;
    else if (e.shiftKey && e.key === "ArrowLeft") next = split - 10;
    else if (e.shiftKey && e.key === "ArrowRight") next = split + 10;
    if (next !== null) {
      e.preventDefault();
      setSplit(Math.max(0, Math.min(100, next)));
    }
  }

  const align = selected.alignment_quality;

  return (
    <div className="space-y-4">
      {/* Toolbar: scan chips + mode control */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Scan" className="flex flex-wrap items-center gap-1.5">
          {scans.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={i === scanIdx}
              onClick={() => setScanIdx(i)}
              title={s.flight?.flight_code ?? fmtDateTime(s.processed_at)}
              className={clsx(
                "btn h-8 gap-1.5 border px-2.5 font-mono text-xs",
                i === scanIdx
                  ? "border-sky-500 bg-sky-500/10 text-sky-200"
                  : "border-surface-border text-slate-400 hover:text-white"
              )}
            >
              {chipLabel(s)}
              {i === 0 && (
                <span className="rounded bg-sky-500/20 px-1 text-label normal-case tracking-normal text-sky-200">
                  LATEST
                </span>
              )}
            </button>
          ))}
        </div>

        <div
          role="radiogroup"
          aria-label="Comparison mode"
          className="ml-auto flex h-8 items-center gap-0.5 rounded-lg border border-surface-border p-0.5 font-mono text-[11px] uppercase"
        >
          {MODES.map((m) => {
            const disabled = m.id === "diff" && !diffAvailable;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={effectiveMode === m.id}
                disabled={disabled}
                title={disabled ? "No diff overlay for this scan" : undefined}
                onClick={() => setMode(m.id)}
                className={clsx(
                  "h-7 rounded-md px-2.5 transition disabled:cursor-not-allowed disabled:opacity-40",
                  effectiveMode === m.id ? "bg-sky-700 text-white" : "text-slate-400 hover:text-white"
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Frame */}
      <div className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-xl border border-surface-border bg-black">
        {effectiveMode === "swipe" && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={baselineUrl}
              alt={baselineLabel}
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.image_url_current}
              alt={`Selected scan ${chipLabel(selected)}`}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 0 0 ${split}%)` }}
              draggable={false}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-amber-400"
              style={{ left: `${split}%` }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-amber-400 bg-black/70 text-amber-300"
              style={{ left: `${split}%` }}
            >
              <MoveHorizontal className="h-4 w-4" />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              onKeyDown={onSliderKey}
              aria-label="Comparison split"
              aria-valuetext={`${split}% of frame shows ${baselineLabel}`}
              className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0 accent-amber-400 focus-visible:opacity-100 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <FrameLabel side="left">{baselineShort}</FrameLabel>
            <FrameLabel side="right">{selectedShort}</FrameLabel>
          </>
        )}

        {effectiveMode === "side" && (
          <div className="grid h-full grid-cols-2 divide-x divide-surface-border">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={baselineUrl}
                alt={baselineLabel}
                className="h-full w-full object-contain"
                draggable={false}
              />
              <FrameLabel side="left">{baselineShort}</FrameLabel>
            </div>
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selected.image_url_current}
                alt={`Selected scan ${chipLabel(selected)}`}
                className="h-full w-full object-contain"
                draggable={false}
              />
              <FrameLabel side="right">{selectedShort}</FrameLabel>
            </div>
          </div>
        )}

        {effectiveMode === "diff" && selected.image_url_diff && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.image_url_current}
              alt={`Selected scan ${chipLabel(selected)}`}
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.image_url_diff}
              alt="Change-detection overlay"
              className="absolute inset-0 h-full w-full object-contain mix-blend-screen"
              style={{ opacity: diffOpacity / 100 }}
              draggable={false}
            />
            <FrameLabel side="left">DIFF OVERLAY</FrameLabel>
            <FrameLabel side="right">{selectedShort}</FrameLabel>
          </>
        )}
      </div>

      {effectiveMode === "diff" && (
        <label className="flex items-center gap-3 text-xs text-slate-400">
          <span className="kicker">Overlay</span>
          <input
            type="range"
            min={0}
            max={100}
            value={diffOpacity}
            onChange={(e) => setDiffOpacity(Number(e.target.value))}
            aria-label="Diff overlay opacity"
            className="w-48 accent-amber-400"
          />
          <span className="font-mono tabular-nums">{diffOpacity}%</span>
        </label>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Cell
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Confidence"
          className="col-span-2 sm:col-span-1"
        >
          <ConfidenceBar value={selected.vacancy_confidence} size="lg" className="mt-1" />
        </Cell>
        <Cell
          icon={<Sprout className="h-3.5 w-3.5" />}
          label="Lawn index"
          value={selected.lawn_growth_index?.toFixed(2) ?? "—"}
          tone={(selected.lawn_growth_index ?? 0) > 0.1 ? "warn" : "default"}
        />
        <Cell
          icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          label="Change"
          value={fmtPct(selected.change_score)}
        />
        <Cell
          icon={<Car className="h-3.5 w-3.5" />}
          label="Vehicle"
          value={
            selected.vehicle_present === null
              ? "—"
              : selected.vehicle_present
                ? selected.vehicle_static
                  ? "static"
                  : "present"
                : "none"
          }
        />
        <Cell
          icon={<Crosshair className="h-3.5 w-3.5" />}
          label="Align"
          value={align == null ? "—" : align.toFixed(2)}
          tone={alignTone(align)}
          title={
            align == null
              ? "Alignment quality unavailable"
              : align < 0.5
                ? `Alignment ${align.toFixed(2)} — diff unreliable below 0.5`
                : `Alignment quality ${align.toFixed(2)} (1.0 = perfect registration)`
          }
        />
      </div>

      {!ctx && (
        <DispatchCard
          propertyId={propertyId}
          scanId={selected.id}
          address={address}
          alreadyDispatched={alreadyDispatched}
          dispatchDisabledReason={dispatchDisabledReason}
        />
      )}
    </div>
  );
}

function FrameLabel({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "pointer-events-none absolute top-3 rounded bg-black/70 px-2 py-1 font-mono text-[11px] tracking-wider text-slate-200",
        side === "left" ? "left-3" : "right-3"
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dispatch card
// ---------------------------------------------------------------------------
type DispatchState = "idle" | "confirm" | "sending" | "sent" | "error";
const CONFIRM_SECONDS = 3;

/**
 * Two-step CRM dispatch with inline server errors. Reads the selected scan
 * from `VerificationProvider` when present, otherwise from `scanId`.
 */
export function DispatchCard({
  propertyId,
  scanId,
  address,
  alreadyDispatched,
  dispatchDisabledReason = null,
}: {
  propertyId: string;
  scanId?: string | null;
  address?: string;
  alreadyDispatched: boolean;
  dispatchDisabledReason?: string | null;
}) {
  const ctx = useContext(VerificationCtx);
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<DispatchState>(alreadyDispatched ? "sent" : "idle");
  const [countdown, setCountdown] = useState(CONFIRM_SECONDS);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const effectiveScanId = ctx?.scanId ?? scanId ?? null;
  const label = address ?? "lead";

  useEffect(() => {
    if (state !== "confirm") return;
    setCountdown(CONFIRM_SECONDS);
    const started = Date.now();
    const iv = setInterval(() => {
      const left = CONFIRM_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) setState("idle");
      else setCountdown(left);
    }, 250);
    return () => clearInterval(iv);
  }, [state]);

  async function send() {
    setState("sending");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, scanId: effectiveScanId ?? undefined }),
      });
      let body: { ok?: boolean; forwarded?: boolean; error?: string } = {};
      try {
        body = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        const msg = body.error ?? `Dispatch failed (HTTP ${res.status})`;
        setErrorMsg(msg);
        setState("error");
        toast.error(`Dispatch failed: ${msg}`);
        return;
      }
      setState("sent");
      if (body.forwarded === false) {
        toast.info(
          `Marked ${label} dispatched — CRM_WEBHOOK_URL is not set, so nothing was forwarded.`
        );
      } else {
        toast.success(`Dispatched ${label} to CRM`);
      }
      router.refresh();
    } catch {
      setErrorMsg("Network error — the request did not reach the server.");
      setState("error");
    }
  }

  const disabled = Boolean(dispatchDisabledReason) || state === "sending" || state === "sent";

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-start gap-2 text-xs text-slate-400">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
        <p>
          Verify the imagery manually before dispatching. Dispatch marks the parcel{" "}
          <span className="text-emerald-300">dispatched</span> and posts the lead to the CRM
          webhook.
        </p>
      </div>

      {dispatchDisabledReason && state !== "sent" && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {dispatchDisabledReason}
        </p>
      )}

      {state === "sent" ? (
        <div className="btn h-9 w-full cursor-default bg-emerald-600/20 px-4 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Dispatched
        </div>
      ) : state === "confirm" ? (
        <button
          type="button"
          onClick={send}
          className="btn-danger w-full"
          aria-live="polite"
        >
          <Send className="h-4 w-4" aria-hidden /> Confirm dispatch ({countdown}s)
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setState("confirm")}
          disabled={disabled}
          className="btn-primary w-full"
        >
          {state === "sending" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          {state === "sending" ? "Dispatching…" : "Dispatch lead to CRM"}
        </button>
      )}

      {state === "error" && errorMsg && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          <span className="min-w-0 break-words">{errorMsg}</span>
          <button type="button" onClick={send} className="btn-ghost h-6 shrink-0 px-1.5 text-red-200">
            <RefreshCw className="h-3 w-3" aria-hidden /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
