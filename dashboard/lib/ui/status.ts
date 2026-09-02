import type { LeadStatus } from "../types";
import type { DroneState, MissionStatus } from "../ops-types";

/**
 * One status vocabulary for the whole console.
 *
 * amber = attention/flagged (also the primary action colour)
 * cyan  = aircraft & mission activity
 * emerald = done / idle / dispatched
 * red   = threshold / abort / stale
 * slate = neutral / queued / offline
 */
export interface StatusStyle {
  label: string;
  /** Classes for a pill badge (border + bg + text). */
  badge: string;
  /** Classes for an 8px dot. */
  dot: string;
  /** Raw colour for canvases (Leaflet markers, SVG). */
  hex: string;
}

export const LEAD_STATUS: Record<LeadStatus, StatusStyle> = {
  active: {
    label: "Active",
    badge: "border-slate-500/40 bg-slate-500/15 text-slate-300",
    dot: "bg-status-active",
    hex: "#94a3b8",
  },
  flagged: {
    label: "Flagged",
    badge: "border-amber-500/40 bg-amber-500/15 text-amber-300",
    dot: "bg-status-flagged",
    hex: "#fbbf24",
  },
  dispatched: {
    label: "Dispatched",
    badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    dot: "bg-status-dispatched",
    hex: "#34d399",
  },
};

export const MISSION_STATUS: Record<MissionStatus, StatusStyle> = {
  queued: {
    label: "Queued",
    badge: "border-slate-500/40 bg-slate-500/15 text-slate-300",
    dot: "bg-slate-400",
    hex: "#94a3b8",
  },
  active: {
    label: "Active",
    badge: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
    dot: "bg-cyan-400",
    hex: "#22d3ee",
  },
  completed: {
    label: "Completed",
    badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    dot: "bg-emerald-400",
    hex: "#34d399",
  },
  aborted: {
    label: "Aborted",
    badge: "border-red-500/40 bg-red-500/15 text-red-300",
    dot: "bg-red-400",
    hex: "#f87171",
  },
};

export const DRONE_STATE: Record<DroneState, StatusStyle> = {
  offline: {
    label: "Offline",
    badge: "border-slate-500/40 bg-slate-500/15 text-slate-400",
    dot: "bg-drone-offline",
    hex: "#64748b",
  },
  idle: {
    label: "Idle",
    badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    dot: "bg-drone-idle",
    hex: "#34d399",
  },
  enroute: {
    label: "En route",
    badge: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
    dot: "bg-drone-enroute",
    hex: "#22d3ee",
  },
  mapping: {
    label: "Mapping",
    badge: "border-cyan-400/40 bg-cyan-400/15 text-cyan-200",
    dot: "bg-drone-mapping",
    hex: "#67e8f9",
  },
  rtb: {
    label: "RTB",
    badge: "border-orange-500/40 bg-orange-500/15 text-orange-300",
    dot: "bg-drone-rtb",
    hex: "#fb923c",
  },
};

/** Drone states during which the aircraft is airborne (dot pulses). */
export const AIRBORNE_STATES: ReadonlySet<DroneState> = new Set<DroneState>([
  "enroute",
  "mapping",
  "rtb",
]);

/** Aircraft marker colour — cyan, matching mission activity. */
export const AIRCRAFT_HEX = "#22d3ee";
/** Mission AO polygon colour. */
export const MISSION_AO_HEX = "#38bdf8";
