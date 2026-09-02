import { z } from "zod";
import { ACTION_LABELS, TRIGGER_LABELS, type ActionType, type TriggerType } from "../ops-types";
import {
  CONTACT_CHANNELS,
  CONTACT_ROLES,
  CRM_STAGES,
  LOGGABLE_ACTIVITY_KINDS,
  PRIORITIES,
  VERIFICATION_VERDICTS,
} from "../types";
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

/** Contact / activity ids: seeded `m1-c1` style in mock mode, uuids in Supabase mode. */
export const CrmId = ScanId;

export const CrmStageEnum = z.enum(CRM_STAGES as [string, ...string[]]);
export const VerdictEnum = z.enum(VERIFICATION_VERDICTS as [string, ...string[]]);

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
const VerdictTriggerConfig = z.strictObject({
  verdict: VerdictEnum.optional(),
});
const StageTriggerConfig = z.strictObject({
  stage: CrmStageEnum.optional(),
});

export const ActionConfig = z.strictObject({
  /** dispatch_webhook */
  url: z.string().url().max(2048).optional(),
  /** set_stage */
  stage: CrmStageEnum.optional(),
  /** create_task */
  title: z.string().trim().min(1).max(200).optional(),
  due_in_days: z.number().int().min(0).max(365).optional(),
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
    z.strictObject({
      ...ruleBase,
      triggerType: z.literal("verdict_recorded"),
      triggerConfig: VerdictTriggerConfig.default({}),
    }),
    z.strictObject({
      ...ruleBase,
      triggerType: z.literal("stage_changed"),
      triggerConfig: StageTriggerConfig.default({}),
    }),
  ])
  .refine((r) => r.actionType === "dispatch_webhook" || r.actionConfig.url === undefined, {
    message: "actionConfig.url is only valid for dispatch_webhook",
    path: ["actionConfig", "url"],
  })
  .refine((r) => r.actionType !== "set_stage" || r.actionConfig.stage !== undefined, {
    message: "set_stage needs actionConfig.stage",
    path: ["actionConfig", "stage"],
  })
  .refine((r) => r.actionType === "set_stage" || r.actionConfig.stage === undefined, {
    message: "actionConfig.stage is only valid for set_stage",
    path: ["actionConfig", "stage"],
  })
  .refine((r) => r.actionType !== "create_task" || r.actionConfig.title !== undefined, {
    message: "create_task needs actionConfig.title",
    path: ["actionConfig", "title"],
  })
  .refine(
    (r) =>
      r.actionType === "create_task" ||
      (r.actionConfig.title === undefined && r.actionConfig.due_in_days === undefined),
    {
      message: "actionConfig.title / due_in_days are only valid for create_task",
      path: ["actionConfig", "title"],
    },
  );
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
  z.strictObject({
    trigger: z.literal("verdict_recorded"),
    payload: z.strictObject({
      property_id: PropertyId,
      verdict: VerdictEnum,
      vacancy_confidence: z.number().int().min(0).max(100).optional(),
    }),
  }),
  z.strictObject({
    trigger: z.literal("stage_changed"),
    payload: z.strictObject({
      property_id: PropertyId,
      stage: CrmStageEnum,
      previous_stage: CrmStageEnum.optional(),
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
// JSON routes receive real numbers: no coercion, so `true`, `null` or `[]`
// can never turn into 1 / 0 and silently relocate a parcel. The CSV importer
// (lib/import/parse.ts) is the only place string cells are converted.
const Lat = z.number().finite().min(-90).max(90);
const Lng = z.number().finite().min(-180).max(180);
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

const Money = z.number().finite().min(0).max(1_000_000_000);
const IsoDateOrNull = z
  .string()
  .trim()
  .refine((s) => s === "" || !Number.isNaN(new Date(s).getTime()), "must be a date")
  .nullable();

export const PropertyPatch = z.strictObject({
  address: z.string().trim().min(1).max(200).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
  neighborhood: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  // CRM
  priority: z.enum(PRIORITIES as [string, ...string[]]).optional(),
  assigned_to: z.string().trim().max(80).nullable().optional(),
  owner_name: z.string().trim().max(120).nullable().optional(),
  next_action: z.string().trim().max(200).nullable().optional(),
  next_action_at: IsoDateOrNull.optional(),
  asking_price: Money.nullable().optional(),
  offer_price: Money.nullable().optional(),
  arv: Money.nullable().optional(),
  repair_estimate: Money.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(20).optional(),
});
export type PropertyPatchInput = z.infer<typeof PropertyPatch>;

/** POST /api/properties/[id]/stage */
export const StageChange = z.strictObject({
  stage: CrmStageEnum,
  note: z.string().trim().max(2000).nullish(),
});
export type StageChangeInput = z.infer<typeof StageChange>;

// ---------------------------------------------------------------------------
// CRM — contacts & activities
// ---------------------------------------------------------------------------
const contactFields = {
  name: z.string().trim().min(1).max(120),
  role: z.enum(CONTACT_ROLES as [string, ...string[]]).default("other"),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().max(254).or(z.literal("")).nullish(),
  mailing_address: z.string().trim().max(300).nullish(),
  preferred_channel: z.enum(CONTACT_CHANNELS as [string, ...string[]]).nullish(),
  do_not_contact: z.boolean().default(false),
  source: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
};

export const ContactCreate = z.strictObject(contactFields);
export type ContactCreateInput = z.infer<typeof ContactCreate>;

export const ContactPatch = z.strictObject({
  name: contactFields.name.optional(),
  role: z.enum(CONTACT_ROLES as [string, ...string[]]).optional(),
  phone: contactFields.phone,
  email: contactFields.email,
  mailing_address: contactFields.mailing_address,
  preferred_channel: contactFields.preferred_channel,
  do_not_contact: z.boolean().optional(),
  source: contactFields.source,
  notes: contactFields.notes,
});
export type ContactPatchInput = z.infer<typeof ContactPatch>;

export const ActivityCreate = z
  .strictObject({
    kind: z.enum(LOGGABLE_ACTIVITY_KINDS as [string, ...string[]]),
    body: z.string().trim().min(1).max(4000),
    outcome: z.string().trim().max(120).nullish(),
    amount: Money.nullish(),
    contact_id: CrmId.nullish(),
    due_at: IsoDateOrNull.optional(),
  })
  .refine((a) => a.kind !== "task" || (a.due_at != null && a.due_at !== ""), {
    message: "a task needs a due date",
    path: ["due_at"],
  });
export type ActivityCreateInput = z.infer<typeof ActivityCreate>;

/** PATCH /api/properties/[id]/activities/[activityId] — complete / reopen / edit. */
export const ActivityPatch = z
  .strictObject({
    completed: z.boolean().optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    outcome: z.string().trim().max(120).nullable().optional(),
    due_at: IsoDateOrNull.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to update" });
export type ActivityPatchInput = z.infer<typeof ActivityPatch>;

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
  altitude_m: z.number().finite().min(5).max(500).nullish(),
  gsd_cm_per_px: z.number().finite().min(0.1).max(100).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type FlightCreateInput = z.infer<typeof FlightCreate>;

export const FlightPatch = z.strictObject({
  flown_at: IsoDate.optional(),
  neighborhood: z.string().trim().min(1).max(80).optional(),
  drone_model: z.string().trim().min(1).max(80).optional(),
  altitude_m: z.number().finite().min(5).max(500).nullable().optional(),
  gsd_cm_per_px: z.number().finite().min(0.1).max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type FlightPatchInput = z.infer<typeof FlightPatch>;

export const LoginBody = z.strictObject({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});
