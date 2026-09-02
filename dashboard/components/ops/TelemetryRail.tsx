"use client";

import clsx from "clsx";
import {
  BatteryMedium,
  Gauge,
  MountainSnow,
  Navigation,
  Radio,
  Satellite,
} from "lucide-react";
import type { Telemetry } from "@/lib/ops-types";
import { AIRBORNE_STATES, DRONE_STATE } from "@/lib/ui/status";
import { fmtAge } from "@/lib/format";
import { LOW_BATTERY_PCT, LOW_LINK_PCT } from "@/lib/constants";
import { Cell } from "@/components/ui/Cell";

export type LinkState = "connecting" | "live" | "reconnecting" | "stale";

const LINK_PILL: Record<LinkState, { label: string; className: string }> = {
  connecting: {
    label: "Connecting",
    className: "bg-amber-500/15 text-amber-300 motion-safe:animate-pulse",
  },
  live: { label: "Live", className: "bg-emerald-500/15 text-emerald-300" },
  reconnecting: {
    label: "Reconnecting",
    className: "bg-amber-500/15 text-amber-300 motion-safe:animate-pulse",
  },
  stale: { label: "Stale", className: "bg-red-500/15 text-red-300" },
};

// Battery / link warning bands (integrator swaps for lib/constants.ts).
const BATTERY_WARN = 40;
const BATTERY_CRIT = LOW_BATTERY_PCT;
const LINK_WARN = LOW_LINK_PCT;

export function TelemetryRail({
  telemetry,
  link,
  frameAgeMs,
  reconnects = 0,
}: {
  telemetry: Telemetry | null;
  link: LinkState;
  /** Age of the last frame in ms; null before the first frame. */
  frameAgeMs: number | null;
  reconnects?: number;
}) {
  const live = link === "live";
  const state = telemetry?.state ?? "offline";
  const style = DRONE_STATE[state];
  const pill = LINK_PILL[link];

  const batt = telemetry?.batteryPct ?? null;
  const battTone =
    batt === null ? "ok" : batt < BATTERY_CRIT ? "danger" : batt < BATTERY_WARN ? "warn" : "ok";
  const lq = telemetry?.linkQuality ?? null;
  const linkTone = lq === null ? "ok" : lq < LINK_WARN ? "danger" : "ok";

  return (
    <section className="panel p-4" aria-labelledby="aircraft-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="aircraft-title" className="panel-title">
          Aircraft
        </h2>
        <span
          role="status"
          className={clsx(
            "rounded px-1.5 py-0.5 font-mono text-label uppercase",
            pill.className
          )}
          title={reconnects > 0 ? `${reconnects} reconnect${reconnects === 1 ? "" : "s"}` : undefined}
        >
          {pill.label}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-sm text-white">
          {telemetry?.serial ?? "—"}{" "}
          <span className="text-slate-400">
            {telemetry?.model ?? (link === "connecting" ? "waiting for link" : "no link")}
          </span>
        </p>
        <span className="flex shrink-0 items-center gap-2 text-xs text-slate-300">
          <span
            aria-hidden
            className={clsx(
              "h-2 w-2 rounded-full",
              style.dot,
              live && AIRBORNE_STATES.has(state) && "motion-safe:animate-pulse"
            )}
          />
          {live || !telemetry ? style.label.toUpperCase() : `${style.label.toUpperCase()}?`}
        </span>
      </div>

      <p
        className={clsx(
          "mt-1 font-mono text-label uppercase",
          link === "stale" ? "text-red-300" : "text-slate-400"
        )}
        aria-live="polite"
      >
        {frameAgeMs === null
          ? "No frame yet"
          : `Last frame ${fmtAge(frameAgeMs)} ago`}
        {reconnects > 0 && ` · ${reconnects} reconnect${reconnects === 1 ? "" : "s"}`}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Cell
          dim={!live}
          icon={<BatteryMedium className="h-3.5 w-3.5" />}
          label="Batt"
          value={batt === null ? "—" : `${batt.toFixed(0)}%`}
          tone={battTone === "danger" ? "danger" : battTone === "warn" ? "warn" : "default"}
          bar={batt === null ? undefined : { pct: batt, tone: battTone }}
        />
        <Cell
          dim={!live}
          icon={<MountainSnow className="h-3.5 w-3.5" />}
          label="Alt"
          value={telemetry ? `${telemetry.altM.toFixed(0)} m` : "—"}
        />
        <Cell
          dim={!live}
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="Spd"
          value={telemetry ? `${telemetry.speedMps.toFixed(1)} m/s` : "—"}
        />
        <Cell
          dim={!live}
          icon={
            <Navigation
              className="h-3.5 w-3.5 transition-transform"
              style={{ transform: `rotate(${(telemetry?.headingDeg ?? 0) - 45}deg)` }}
            />
          }
          label="Hdg"
          value={telemetry ? `${telemetry.headingDeg.toFixed(0)}°` : "—"}
        />
        <Cell
          dim={!live}
          icon={<Satellite className="h-3.5 w-3.5" />}
          label="Sats"
          value={telemetry ? `${telemetry.satellites}` : "—"}
          tone={telemetry && telemetry.satellites < 8 ? "warn" : "default"}
        />
        <Cell
          dim={!live}
          icon={<Radio className="h-3.5 w-3.5" />}
          label="Link"
          value={lq === null ? "—" : `${lq.toFixed(0)}%`}
          tone={linkTone === "danger" ? "danger" : "default"}
          bar={lq === null ? undefined : { pct: lq, tone: linkTone }}
        />
      </div>

      {telemetry && telemetry.missionId && (
        <div className={clsx("mt-3", !live && "opacity-60 grayscale")}>
          <div className="flex justify-between font-mono text-label uppercase text-slate-400">
            <span>Mission progress</span>
            <span className="tabular-nums">{telemetry.missionProgress.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full bg-cyan-400 transition-all"
              style={{ width: `${telemetry.missionProgress}%` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
