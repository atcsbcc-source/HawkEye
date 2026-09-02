"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PropertyLead } from "@/lib/types";
import type { AuditEvent, Mission, Telemetry } from "@/lib/ops-types";
import { TelemetryRail } from "./TelemetryRail";
import { MissionQueue } from "./MissionQueue";
import { AuditFeed } from "./AuditFeed";

const OpsMap = dynamic(() => import("./OpsMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-slate-500">
      Loading tactical map…
    </div>
  ),
});

/** Bounding box of all tracked parcels, padded ~120m — the default AO. */
function aoPolygon(leads: PropertyLead[]): [number, number][] {
  const lats = leads.map((l) => l.lat);
  const lngs = leads.map((l) => l.lng);
  const pad = 0.0011;
  const [minLat, maxLat] = [Math.min(...lats) - pad, Math.max(...lats) + pad];
  const [minLng, maxLng] = [Math.min(...lngs) - pad, Math.max(...lngs) + pad];
  return [
    [minLat, minLng],
    [minLat, maxLng],
    [maxLat, maxLng],
    [maxLat, minLng],
  ];
}

export function OpsConsole({ leads }: { leads: PropertyLead[] }) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const missionCounter = useRef(1);

  // Live telemetry over SSE.
  useEffect(() => {
    const es = new EventSource("/api/telemetry");
    es.onmessage = (ev) => {
      try {
        setTelemetry(JSON.parse(ev.data));
      } catch {
        /* skip malformed frame */
      }
    };
    return () => es.close();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [m, e] = await Promise.all([
        fetch("/api/missions").then((r) => r.json()),
        fetch("/api/audit").then((r) => r.json()),
      ]);
      setMissions(m.missions ?? []);
      setEvents(e.events ?? []);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [refresh]);

  const activeMission = useMemo(
    () => missions.find((m) => m.status === "active") ?? null,
    [missions]
  );

  async function createMission() {
    if (leads.length === 0) return;
    setBusy(true);
    const week = new Date().toISOString().slice(0, 10);
    await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Oakwood grid ${week} #${missionCounter.current++}`,
        polygon: aoPolygon(leads),
      }),
    }).catch(() => undefined);
    setBusy(false);
    refresh();
  }

  async function missionAction(id: string, action: "launch" | "abort") {
    setBusy(true);
    await fetch("/api/missions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    }).catch(() => undefined);
    setBusy(false);
    refresh();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="h-[34rem] overflow-hidden rounded-xl border border-surface-border xl:col-span-2 xl:h-[calc(100vh-8.5rem)]">
        <OpsMap leads={leads} telemetry={telemetry} activeMission={activeMission} />
      </div>
      <div className="space-y-4">
        <TelemetryRail telemetry={telemetry} />
        <MissionQueue
          missions={missions}
          busy={busy}
          onCreate={createMission}
          onAction={missionAction}
        />
        <AuditFeed events={events} compact />
      </div>
    </div>
  );
}
