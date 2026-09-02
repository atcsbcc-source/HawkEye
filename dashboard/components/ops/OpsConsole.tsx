"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PropertyLead } from "@/lib/types";
import type { AuditEvent, Mission, Telemetry } from "@/lib/ops-types";
import { useToast } from "@/components/ui/Toast";
import { TelemetryRail, type LinkState } from "./TelemetryRail";
import { MissionQueue } from "./MissionQueue";
import { AuditFeed } from "./AuditFeed";

const OpsMap = dynamic(() => import("./OpsMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-slate-400">
      Loading tactical map…
    </div>
  ),
});

/** Frames older than this are considered stale. */
const STALE_MS = 3000;

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

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function OpsConsole({ leads }: { leads: PropertyLead[] }) {
  const toast = useToast();
  const focusId = useSearchParams()?.get("focus") ?? null;

  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [link, setLink] = useState<LinkState>("connecting");
  const [reconnects, setReconnects] = useState(0);
  const [frameAt, setFrameAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const missionCounter = useRef(1);

  // Live telemetry over SSE with link-state tracking.
  useEffect(() => {
    const es = new EventSource("/api/telemetry");
    es.onopen = () => setLink("live");
    es.onerror = () => {
      setReconnects((n) => n + 1);
      setLink((prev) => (prev === "stale" ? "stale" : "reconnecting"));
    };
    es.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as Telemetry;
        setTelemetry(frame);
        const t = Date.parse(frame.ts);
        setFrameAt(Number.isFinite(t) ? Math.min(t, Date.now()) : Date.now());
        setLink("live");
      } catch {
        /* skip malformed frame */
      }
    };
    return () => es.close();
  }, []);

  // 1 s watchdog: a link with no fresh frame is STALE, whatever EventSource says.
  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setLink((prev) =>
        frameAt !== null && prev !== "connecting" && t - frameAt > STALE_MS ? "stale" : prev,
      );
    }, 1000);
    return () => clearInterval(iv);
  }, [frameAt]);

  const frameAgeMs = frameAt === null ? null : Math.max(0, now - frameAt);

  const refresh = useCallback(async () => {
    try {
      const [mr, er] = await Promise.all([fetch("/api/missions"), fetch("/api/audit")]);
      if (!mr.ok || !er.ok) throw new Error("refresh failed");
      const [m, e] = await Promise.all([mr.json(), er.json()]);
      setMissions(m.missions ?? []);
      setEvents(e.events ?? []);
      setPollFailed(false);
      setLastOk(Date.now());
    } catch {
      setPollFailed(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [refresh]);

  const activeMission = useMemo(
    () => missions?.find((m) => m.status === "active") ?? null,
    [missions],
  );

  async function createMission() {
    if (leads.length === 0) {
      toast.error("No parcels tracked — cannot derive an area of operations.");
      return;
    }
    setCreating(true);
    const week = new Date().toISOString().slice(0, 10);
    const name = `Oakwood grid ${week} #${missionCounter.current++}`;
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, polygon: aoPolygon(leads) }),
      });
      if (!res.ok) {
        toast.error(await readError(res, `Could not create mission (HTTP ${res.status})`));
      } else {
        toast.success(`Queued ${name}`);
      }
    } catch {
      toast.error("Network error — mission not created.");
    } finally {
      setCreating(false);
      refresh();
    }
  }

  async function missionAction(id: string, action: "launch" | "abort") {
    setPendingId(id);
    try {
      const res = await fetch("/api/missions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        toast.error(await readError(res, `Mission ${action} failed (HTTP ${res.status})`));
      } else {
        toast.success(
          action === "launch" ? "Mission launched" : "Abort sent — aircraft returning to base",
        );
      }
    } catch {
      toast.error(`Network error — mission ${action} not sent.`);
    } finally {
      setPendingId(null);
      refresh();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* `isolate` keeps Leaflet's z-index:1000 controls under the sticky header. */}
      <div className="isolate h-[60vh] min-h-[20rem] overflow-hidden rounded-xl border border-surface-border lg:h-[calc(100vh-7.5rem)]">
        <OpsMap
          leads={leads}
          telemetry={telemetry}
          activeMission={activeMission}
          stale={link !== "live"}
          focusId={focusId}
        />
      </div>
      <div className="space-y-4 lg:h-[calc(100vh-7.5rem)] lg:overflow-y-auto lg:pr-1">
        <TelemetryRail
          telemetry={telemetry}
          link={link}
          frameAgeMs={frameAgeMs}
          reconnects={reconnects}
        />
        <MissionQueue
          missions={missions}
          pendingId={pendingId}
          creating={creating}
          onCreate={createMission}
          onAction={missionAction}
          pollFailed={pollFailed}
          lastOk={lastOk}
        />
        <AuditFeed events={events} compact pollFailed={pollFailed} lastOk={lastOk} />
      </div>
    </div>
  );
}
