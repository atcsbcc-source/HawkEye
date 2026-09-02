"use client";

import clsx from "clsx";
import {
  BatteryMedium,
  Compass,
  Gauge,
  MountainSnow,
  Radio,
  Satellite,
} from "lucide-react";
import type { Telemetry } from "@/lib/ops-types";

const STATE_TONE: Record<string, string> = {
  offline: "bg-slate-600",
  idle: "bg-emerald-500",
  enroute: "bg-sky-500",
  mapping: "bg-amber-400",
  rtb: "bg-fuchsia-500",
};

export function TelemetryRail({ telemetry }: { telemetry: Telemetry | null }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Aircraft
        </p>
        <span className="flex items-center gap-2 text-xs text-slate-300">
          <span
            className={clsx(
              "h-2 w-2 rounded-full",
              STATE_TONE[telemetry?.state ?? "offline"],
              telemetry && telemetry.state !== "offline" && telemetry.state !== "idle" && "animate-pulse"
            )}
          />
          {(telemetry?.state ?? "offline").toUpperCase()}
        </span>
      </div>

      <p className="mt-1 font-mono text-sm text-white">
        {telemetry?.serial ?? "—"}{" "}
        <span className="text-slate-500">{telemetry?.model ?? "no link"}</span>
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Cell icon={<BatteryMedium className="h-3.5 w-3.5" />} label="BATT"
              value={telemetry ? `${telemetry.batteryPct.toFixed(0)}%` : "—"}
              warn={!!telemetry && telemetry.batteryPct < 25} />
        <Cell icon={<MountainSnow className="h-3.5 w-3.5" />} label="ALT"
              value={telemetry ? `${telemetry.altM.toFixed(0)}m` : "—"} />
        <Cell icon={<Gauge className="h-3.5 w-3.5" />} label="SPD"
              value={telemetry ? `${telemetry.speedMps.toFixed(1)}m/s` : "—"} />
        <Cell icon={<Compass className="h-3.5 w-3.5" />} label="HDG"
              value={telemetry ? `${telemetry.headingDeg.toFixed(0)}°` : "—"} />
        <Cell icon={<Satellite className="h-3.5 w-3.5" />} label="SATS"
              value={telemetry ? `${telemetry.satellites}` : "—"} />
        <Cell icon={<Radio className="h-3.5 w-3.5" />} label="LINK"
              value={telemetry ? `${telemetry.linkQuality.toFixed(0)}%` : "—"}
              warn={!!telemetry && telemetry.linkQuality < 60} />
      </div>

      {telemetry && telemetry.missionId && (
        <div className="mt-3">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>MISSION PROGRESS</span>
            <span className="font-mono">{telemetry.missionProgress.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full bg-amber-400 transition-all"
              style={{ width: `${telemetry.missionProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({
  icon,
  label,
  value,
  warn = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] tracking-widest text-slate-500">
        {icon}
        {label}
      </div>
      <p className={clsx("font-mono text-sm", warn ? "text-red-400" : "text-white")}>
        {value}
      </p>
    </div>
  );
}
