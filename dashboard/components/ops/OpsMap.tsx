"use client";

import { useEffect, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { LocateFixed } from "lucide-react";
import type { PropertyLead } from "@/lib/types";
import type { Mission, Telemetry } from "@/lib/ops-types";
import { AIRCRAFT_HEX, LEAD_STATUS, MISSION_AO_HEX } from "@/lib/ui/status";

type LatLng = [number, number];

/** Imperative camera moves driven by props (must live inside MapContainer). */
function Camera({
  flyRequest,
  aircraft,
  focus,
}: {
  flyRequest: number;
  aircraft: LatLng | null;
  focus: LatLng | null;
}) {
  const map = useMap();
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;

  useEffect(() => {
    if (flyRequest === 0 || !aircraftRef.current) return;
    map.flyTo(aircraftRef.current, Math.max(map.getZoom(), 16), { duration: 0.8 });
  }, [flyRequest, map]);

  const focusKey = focus ? `${focus[0]},${focus[1]}` : null;
  useEffect(() => {
    if (!focus) return;
    map.flyTo(focus, 18, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, map]);

  return null;
}

export default function OpsMap({
  leads,
  telemetry,
  activeMission,
  stale = false,
  focusId = null,
}: {
  leads: PropertyLead[];
  telemetry: Telemetry | null;
  activeMission: Mission | null;
  /** Telemetry link is not live — aircraft shown as last known position. */
  stale?: boolean;
  /** Property id to fly to on mount (`/operations?focus=<id>`). */
  focusId?: string | null;
}) {
  const [flyRequest, setFlyRequest] = useState(0);

  const center: LatLng =
    leads.length > 0
      ? [
          leads.reduce((s, l) => s + l.lat, 0) / leads.length,
          leads.reduce((s, l) => s + l.lng, 0) / leads.length,
        ]
      : [35.2271, -80.8431];

  const focusLead = focusId ? leads.find((l) => l.id === focusId) ?? null : null;
  const focus: LatLng | null = focusLead ? [focusLead.lat, focusLead.lng] : null;

  const aircraft: LatLng | null =
    telemetry && telemetry.state !== "offline" ? [telemetry.lat, telemetry.lng] : null;
  const heading = telemetry ? (telemetry.headingDeg * Math.PI) / 180 : 0;
  const headingLine: LatLng[] | null = aircraft
    ? [
        aircraft,
        [aircraft[0] + 0.0006 * Math.cos(heading), aircraft[1] + 0.0006 * Math.sin(heading)],
      ]
    : null;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={focus ?? center}
        zoom={focus ? 18 : 15}
        className="h-full w-full"
        style={{ background: "#0b1220" }}
        attributionControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <Camera flyRequest={flyRequest} aircraft={aircraft} focus={focus} />

        {activeMission && (
          <Polygon
            positions={activeMission.polygon}
            pathOptions={{ color: MISSION_AO_HEX, weight: 1.5, dashArray: "6 4", fillOpacity: 0.05 }}
          />
        )}

        {leads.map((l) => {
          const hex = LEAD_STATUS[l.status]?.hex ?? LEAD_STATUS.active.hex;
          const focused = l.id === focusId;
          return (
            <CircleMarker
              key={l.id}
              center={[l.lat, l.lng]}
              radius={focused ? 9 : 6}
              pathOptions={{
                color: focused ? "#38bdf8" : hex,
                fillColor: hex,
                fillOpacity: 0.7,
                weight: focused ? 3 : 1.5,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <div>
                  <p className="font-semibold text-white">{l.address}</p>
                  <p>
                    {LEAD_STATUS[l.status].label.toUpperCase()}
                    {l.latest_vacancy_confidence != null &&
                      ` · confidence ${l.latest_vacancy_confidence}`}
                    {l.days_distressed != null && ` · ${l.days_distressed} d`}
                  </p>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {aircraft && telemetry && (
          <>
            <CircleMarker
              center={aircraft}
              radius={8}
              pathOptions={
                stale
                  ? {
                      color: AIRCRAFT_HEX,
                      fillColor: AIRCRAFT_HEX,
                      fillOpacity: 0.35,
                      weight: 2,
                      dashArray: "3 3",
                    }
                  : { color: AIRCRAFT_HEX, fillColor: AIRCRAFT_HEX, fillOpacity: 0.9, weight: 2 }
              }
            >
              <Tooltip direction="top" offset={[0, -8]} permanent>
                <span className="font-semibold tracking-widest">
                  {telemetry.serial} · {telemetry.state.toUpperCase()}
                  {stale && <span className="text-red-300"> · LAST KNOWN POSITION</span>}
                </span>
              </Tooltip>
            </CircleMarker>
            {headingLine && !stale && (
              <Polyline positions={headingLine} pathOptions={{ color: AIRCRAFT_HEX, weight: 2 }} />
            )}
          </>
        )}
      </MapContainer>

      {/* Overlay chrome (outside the Leaflet DOM, above its control layer). */}
      <button
        type="button"
        onClick={() => setFlyRequest((n) => n + 1)}
        disabled={!aircraft}
        aria-label="Center on aircraft"
        title={aircraft ? "Center on aircraft" : "Aircraft offline"}
        className="btn-secondary absolute right-3 top-3 z-[1000] h-8 w-8 px-0 shadow-lg shadow-black/40"
      >
        <LocateFixed className="h-4 w-4" aria-hidden />
      </button>

      <div className="panel absolute bottom-6 left-3 z-[1000] px-3 py-2 font-mono text-[11px] text-slate-300 shadow-lg shadow-black/40">
        <ul className="space-y-1">
          {(["flagged", "dispatched", "active"] as const).map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: LEAD_STATUS[s].hex }}
              />
              {LEAD_STATUS[s].label}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full border-2"
              style={{ borderColor: AIRCRAFT_HEX, background: `${AIRCRAFT_HEX}cc` }}
            />
            Aircraft
          </li>
          <li className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 border border-dashed"
              style={{ borderColor: MISSION_AO_HEX }}
            />
            Mission AO
          </li>
        </ul>
      </div>
    </div>
  );
}
