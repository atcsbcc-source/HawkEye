"use client";

import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import type { PropertyLead } from "@/lib/types";
import type { Mission, Telemetry } from "@/lib/ops-types";

const STATUS_COLOR: Record<string, string> = {
  active: "#64748b",
  flagged: "#f59e0b",
  dispatched: "#10b981",
};

export default function OpsMap({
  leads,
  telemetry,
  activeMission,
}: {
  leads: PropertyLead[];
  telemetry: Telemetry | null;
  activeMission: Mission | null;
}) {
  const center: [number, number] =
    leads.length > 0
      ? [
          leads.reduce((s, l) => s + l.lat, 0) / leads.length,
          leads.reduce((s, l) => s + l.lng, 0) / leads.length,
        ]
      : [35.2271, -80.8431];

  const heading = telemetry ? (telemetry.headingDeg * Math.PI) / 180 : 0;
  const headingLine: [number, number][] | null = telemetry
    ? [
        [telemetry.lat, telemetry.lng],
        [
          telemetry.lat + 0.0006 * Math.cos(heading),
          telemetry.lng + 0.0006 * Math.sin(heading),
        ],
      ]
    : null;

  return (
    <MapContainer
      center={center}
      zoom={15}
      className="h-full w-full"
      style={{ background: "#0b1220" }}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      />

      {activeMission && (
        <Polygon
          positions={activeMission.polygon}
          pathOptions={{ color: "#38bdf8", weight: 1.5, dashArray: "6 4", fillOpacity: 0.05 }}
        />
      )}

      {leads.map((l) => (
        <CircleMarker
          key={l.id}
          center={[l.lat, l.lng]}
          radius={6}
          pathOptions={{
            color: STATUS_COLOR[l.status] ?? "#64748b",
            fillColor: STATUS_COLOR[l.status] ?? "#64748b",
            fillOpacity: 0.7,
            weight: 1.5,
          }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <div className="text-xs">
              <p className="font-semibold">{l.address}</p>
              <p>
                {l.status.toUpperCase()}
                {l.latest_vacancy_confidence != null &&
                  ` · confidence ${l.latest_vacancy_confidence}`}
              </p>
            </div>
          </Tooltip>
        </CircleMarker>
      ))}

      {telemetry && telemetry.state !== "offline" && (
        <>
          <CircleMarker
            center={[telemetry.lat, telemetry.lng]}
            radius={8}
            pathOptions={{ color: "#22d3ee", fillColor: "#22d3ee", fillOpacity: 0.9, weight: 2 }}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent>
              <span className="text-[10px] font-semibold tracking-widest">
                {telemetry.serial} · {telemetry.state.toUpperCase()}
              </span>
            </Tooltip>
          </CircleMarker>
          {headingLine && (
            <Polyline
              positions={headingLine}
              pathOptions={{ color: "#22d3ee", weight: 2 }}
            />
          )}
        </>
      )}
    </MapContainer>
  );
}
