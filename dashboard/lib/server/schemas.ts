import { z } from "zod";
import { ACTION_LABELS, TRIGGER_LABELS, type ActionType, type TriggerType } from "../ops-types";
import { isDevMode } from "./env";

/**
 * Request schemas for every API route. All objects are strict (unknown keys
 * rejected) so payloads cannot smuggle extra fields into jsonb columns,
 * audit rows or CRM webhooks.
 */

export const TRIGGER_TYPES = Object.keys(TRIGGER_LABELS) as [TriggerType, ...TriggerType[]];
export const ACTION_TYPES = Object.keys(ACTION_LABELS) as [ActionType, ...ActionType[]];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Property ids are `m1`..`m6` in mock mode and uuids in Supabase mode, so the
 * uuid rule is only enforced when Supabase is configured.
 */
export const PropertyId = z
  .string()
  .min(1)
  .max(64)
  .refine((v) => isDevMode() || UUID_RE.test(v), { message: "must be a uuid" });

export const ScanId = z
  .string()
  .min(1)
  .max(64)
  .refine((v) => isDevMode() || UUID_RE.test(v), {
    message: "must be a uuid",
  });

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------
export const MAX_MISSION_AREA_KM2 = 4;
const METERS_PER_DEG = 111_320;

export const LatLng = z.tuple([
  z.number().finite().min(-90).max(90),
  z.number().finite().min(-180).max(180),
]);

/** Bounding-box area in km² of a [lat,lng] ring. */
export function polygonBoundsKm2(polygon: [number, number][]): number {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of polygon) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const h = (maxLat - minLat) * METERS_PER_DEG;
  const w = (maxLng - minLng) * METERS_PER_DEG * Math.cos(midLat);
  return (h * w) / 1_000_000;
}

export const MissionCreate = z.strictObject({
  name: z.string().trim().min(1).max(80),
  polygon: z
    .array(LatLng)
    .min(3)
    .max(64)
    .refine(
      (p) => {
        const area = polygonBoundsKm2(p);
        return Number.isFinite(area) && area <= MAX_MISSION_AREA_KM2;
      },
      { message: `polygon bounding box must be at most ${MAX_MISSION_AREA_KM2} km²` },
    ),
});
export type MissionCreateInput = z.infer<typeof MissionCreate>;

export const MissionPatch = z.strictObject({
  id: z.uuid(),
  action: z.enum(["launch", "abort"]),
});
export type MissionPatchInput = z.infer<typeof MissionPatch>;

// ---------------------------------------------------------------------------
// Automation rules
// ---------------------------------------------------------------------------
const ScanTriggerConfig = z.strictObject({
  min_confidence: z.number().int().min(0).max(100),
});
const DistressTriggerConfig = z.strictObject({
  min_days: z.number().int().min(1).max(3650),
});
const EmptyConfig = z.strictObject({});

export const ActionConfig = z.strictObject({
  url: z.string().url().max(2048).optional(),
});

const ruleBase = {
  name: z.string().trim().min(1).max(80),
  actionType: z.enum(ACTION_TYPES),
  actionConfig: ActionConfig.default({}),
};

export const RuleCreate = z
  .discriminatedUnion("triggerType", [
    z.strictObject({
      ...ruleBase,
      triggerType: z.literal("scan_processed"),
      triggerConfig: ScanTriggerConfig,
    }),
    z.strictObject({
      ...ruleBase,
      triggerType: z.literal("distress_threshold"),
      triggerConfig: DistressTriggerConfig,
    }),
    z.strictObject({
      ...ruleBase,
      triggerType: z.literal("mission_completed"),
      triggerConfig: EmptyConfig.default({}),
    }),
  ])
  .refine((r) => r.actionType === "dispatch_webhook" || r.actionConfig.url === undefined, {
    message: "actionConfig.url is only valid for dispatch_webhook",
    path: ["actionConfig", "url"],
  });
export type RuleCreateInput = z.infer<typeof RuleCreate>;

export const RulePatch = z.strictObject({
  id: z.uuid(),
  enabled: z.boolean(),
});
export type RulePatchInput = z.infer<typeof RulePatch>;

// ---------------------------------------------------------------------------
// Pipeline -> automation evaluate
// ---------------------------------------------------------------------------
export const Evaluate = z.discriminatedUnion("trigger", [
  z.strictObject({
    trigger: z.literal("scan_processed"),
    payload: z.strictObject({
      property_id: PropertyId,
      parcel_id: z.string().max(64).optional(),
      vacancy_confidence: z.number().int().min(0).max(100),
      lawn_growth_index: z.number().finite().min(-1).max(1).optional(),
    }),
  }),
  z.strictObject({
    trigger: z.literal("distress_threshold"),
    payload: z.strictObject({
      property_id: PropertyId,
      days_distressed: z.number().int().min(0).max(3650),
    }),
  }),
  z.strictObject({
    trigger: z.literal("mission_completed"),
    payload: z.strictObject({
      missionId: z.uuid(),
      name: z.string().max(80).optional(),
    }),
  }),
]);
export type EvaluateInput = z.infer<typeof Evaluate>;

// ---------------------------------------------------------------------------
// Dispatch / audit / auth
// ---------------------------------------------------------------------------
export const Dispatch = z.strictObject({
  propertyId: PropertyId,
  scanId: ScanId.optional(),
});
export type DispatchInput = z.infer<typeof Dispatch>;

export const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Properties / flights / verification (features routes)
// ---------------------------------------------------------------------------
const Lat = z.coerce.number().refine(Number.isFinite, "lat must be a number").min(-90).max(90);
const Lng = z.coerce.number().refine(Number.isFinite, "lng must be a number").min(-180).max(180);
const IsoDate = z
  .string()
  .trim()
  .min(1)
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "flown_at must be a date");

export const PropertyCreate = z.strictObject({
  parcel_id: z.string().trim().min(1).max(64),
  address: z.string().trim().min(1).max(200),
  lat: Lat,
  lng: Lng,
  neighborhood: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type PropertyCreateInput = z.infer<typeof PropertyCreate>;

export const PropertyPatch = z.strictObject({
  address: z.string().trim().min(1).max(200).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
  neighborhood: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type PropertyPatchInput = z.infer<typeof PropertyPatch>;

export const Verify = z.strictObject({
  verdict: z.enum(["verified_vacant", "false_positive", "occupied", "needs_recheck"]),
  note: z.string().trim().max(2000).nullish(),
  scanId: ScanId.nullish(),
});
export type VerifyInput = z.infer<typeof Verify>;

export const FlightCreate = z.strictObject({
  flight_code: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "letters, digits, . _ - only")
    .optional(),
  flown_at: IsoDate,
  neighborhood: z.string().trim().min(1).max(80),
  drone_model: z.string().trim().min(1).max(80).optional(),
  altitude_m: z.coerce.number().min(5).max(500).nullish(),
  gsd_cm_per_px: z.coerce.number().min(0.1).max(100).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type FlightCreateInput = z.infer<typeof FlightCreate>;

export const FlightPatch = z.strictObject({
  flown_at: IsoDate.optional(),
  neighborhood: z.string().trim().min(1).max(80).optional(),
  drone_model: z.string().trim().min(1).max(80).optional(),
  altitude_m: z.coerce.number().min(5).max(500).nullable().optional(),
  gsd_cm_per_px: z.coerce.number().min(0.1).max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type FlightPatchInput = z.infer<typeof FlightPatch>;

export const LoginBody = z.strictObject({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

export const SetPasswordBody = z.strictObject({
  password: z.string().min(12).max(256),
});
