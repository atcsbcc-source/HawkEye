import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AuditQuery,
  Dispatch,
  Evaluate,
  MissionCreate,
  MissionPatch,
  polygonBoundsKm2,
  RuleCreate,
  RulePatch,
} from "../../lib/server/schemas";
import { parseJson } from "../../lib/server/validate";

/** The polygon OpsConsole's "New grid mission" button posts for the mock leads. */
function defaultAoPolygon(): [number, number][] {
  const lats = [35.2271, 35.2302, 35.2189, 35.2244, 35.2268, 35.221];
  const lngs = [-80.8431, -80.8397, -80.8512, -80.8368, -80.844, -80.8455];
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

const UUID = "5f1d1c1e-4b2a-4c3d-9e8f-0a1b2c3d4e5f";

describe("MissionCreate", () => {
  it("accepts the default AO polygon", () => {
    const r = MissionCreate.safeParse({ name: "Oakwood grid", polygon: defaultAoPolygon() });
    expect(r.success).toBe(true);
    expect(polygonBoundsKm2(defaultAoPolygon())).toBeLessThan(4);
  });

  it("rejects the event-loop DoS polygon (huge latitude)", () => {
    const r = MissionCreate.safeParse({
      name: "x",
      polygon: [
        [1e15, 0],
        [1000000000000001, 0],
        [1e15, 1],
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects the simulator-wedging polygon (strings)", () => {
    const r = MissionCreate.safeParse({
      name: "x",
      polygon: [
        ["a", "b"],
        ["c", "d"],
        ["e", "f"],
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects bounding boxes over 4 km²", () => {
    const r = MissionCreate.safeParse({
      name: "big",
      polygon: [
        [35.2, -80.85],
        [35.2, -80.8],
        [35.25, -80.8],
      ],
    });
    expect(r.success).toBe(false);
    expect(
      polygonBoundsKm2([
        [35.2, -80.85],
        [35.2, -80.8],
        [35.25, -80.8],
      ]),
    ).toBeGreaterThan(4);
  });

  it("rejects too few / too many points, non-finite, out of range, unknown keys", () => {
    expect(
      MissionCreate.safeParse({
        name: "x",
        polygon: [
          [0, 0],
          [0, 1],
        ],
      }).success,
    ).toBe(false);
    expect(
      MissionCreate.safeParse({
        name: "x",
        polygon: Array.from({ length: 65 }, (_, i) => [0.0001 * i, 0.0001 * i]),
      }).success,
    ).toBe(false);
    expect(
      MissionCreate.safeParse({
        name: "x",
        polygon: [
          [91, 0],
          [0, 0],
          [0, 1],
        ],
      }).success,
    ).toBe(false);
    expect(
      MissionCreate.safeParse({
        name: "x",
        polygon: [
          [0, 181],
          [0, 0],
          [1, 0],
        ],
      }).success,
    ).toBe(false);
    expect(
      MissionCreate.safeParse({
        name: "x",
        polygon: [
          [0, 0],
          [0, 0.001],
          [0.001, 0],
        ],
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      MissionCreate.safeParse({
        name: "",
        polygon: [
          [0, 0],
          [0, 0.001],
          [0.001, 0],
        ],
      }).success,
    ).toBe(false);
    expect(
      MissionCreate.safeParse({
        name: "a".repeat(81),
        polygon: [
          [0, 0],
          [0, 0.001],
          [0.001, 0],
        ],
      }).success,
    ).toBe(false);
  });
});

describe("MissionPatch / RulePatch", () => {
  it("requires uuid ids and known actions", () => {
    expect(MissionPatch.safeParse({ id: UUID, action: "launch" }).success).toBe(true);
    expect(MissionPatch.safeParse({ id: "nope", action: "launch" }).success).toBe(false);
    expect(MissionPatch.safeParse({ id: UUID, action: "explode" }).success).toBe(false);
    expect(
      RulePatch.safeParse({ id: "00000000-0000-4000-8000-000000000001", enabled: false }).success,
    ).toBe(true);
    expect(RulePatch.safeParse({ id: "rule-default-flag", enabled: true }).success).toBe(false);
    expect(RulePatch.safeParse({ id: UUID, enabled: "yes" }).success).toBe(false);
  });
});

describe("RuleCreate", () => {
  it("validates trigger config by trigger type", () => {
    expect(
      RuleCreate.safeParse({
        name: "flag",
        triggerType: "scan_processed",
        triggerConfig: { min_confidence: 80 },
        actionType: "flag_property",
        actionConfig: {},
      }).success,
    ).toBe(true);
    expect(
      RuleCreate.safeParse({
        name: "flag",
        triggerType: "scan_processed",
        triggerConfig: { min_days: 5 },
        actionType: "flag_property",
        actionConfig: {},
      }).success,
    ).toBe(false);
    expect(
      RuleCreate.safeParse({
        name: "d",
        triggerType: "distress_threshold",
        triggerConfig: { min_days: 60 },
        actionType: "dispatch_webhook",
        actionConfig: { url: "https://hooks.zapier.com/a" },
      }).success,
    ).toBe(true);
    expect(
      RuleCreate.safeParse({
        name: "m",
        triggerType: "mission_completed",
        actionType: "notify",
      }).success,
    ).toBe(true);
  });

  it("rejects url on non-webhook actions, bad urls and extra config keys", () => {
    expect(
      RuleCreate.safeParse({
        name: "flag",
        triggerType: "scan_processed",
        triggerConfig: { min_confidence: 80 },
        actionType: "flag_property",
        actionConfig: { url: "https://example.com" },
      }).success,
    ).toBe(false);
    expect(
      RuleCreate.safeParse({
        name: "d",
        triggerType: "distress_threshold",
        triggerConfig: { min_days: 60 },
        actionType: "dispatch_webhook",
        actionConfig: { url: "not-a-url" },
      }).success,
    ).toBe(false);
    expect(
      RuleCreate.safeParse({
        name: "d",
        triggerType: "distress_threshold",
        triggerConfig: { min_days: 60, evil: true },
        actionType: "dispatch_webhook",
        actionConfig: {},
      }).success,
    ).toBe(false);
  });
});

describe("Evaluate / Dispatch (dev vs supabase mode)", () => {
  const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  it("accepts mock ids in dev mode and requires uuids otherwise", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(Dispatch.safeParse({ propertyId: "m1" }).success).toBe(true);
    expect(
      Evaluate.safeParse({
        trigger: "scan_processed",
        payload: { property_id: "m1", vacancy_confidence: 90 },
      }).success,
    ).toBe(true);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    expect(Dispatch.safeParse({ propertyId: "m1" }).success).toBe(false);
    expect(Dispatch.safeParse({ propertyId: UUID, scanId: UUID }).success).toBe(true);
    expect(
      Evaluate.safeParse({
        trigger: "scan_processed",
        payload: { property_id: UUID, vacancy_confidence: 90 },
      }).success,
    ).toBe(true);
  });

  it("rejects fabricated / oversized payload fields", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(
      Evaluate.safeParse({
        trigger: "scan_processed",
        payload: { property_id: "m1", vacancy_confidence: 101 },
      }).success,
    ).toBe(false);
    expect(
      Evaluate.safeParse({
        trigger: "scan_processed",
        payload: { property_id: "m1", vacancy_confidence: 90, status: "dispatched" },
      }).success,
    ).toBe(false);
    expect(
      Evaluate.safeParse({
        trigger: "distress_threshold",
        payload: { property_id: "m1", days_distressed: 99999 },
      }).success,
    ).toBe(false);
    expect(
      Evaluate.safeParse({ trigger: "mission_completed", payload: { missionId: "abc" } }).success,
    ).toBe(false);
    expect(Evaluate.safeParse({ trigger: "reboot", payload: {} }).success).toBe(false);
  });
});

describe("AuditQuery", () => {
  it("coerces and bounds limit", () => {
    expect(AuditQuery.parse({}).limit).toBeUndefined();
    expect(AuditQuery.parse({ limit: "25" }).limit).toBe(25);
    expect(AuditQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(AuditQuery.safeParse({ limit: "201" }).success).toBe(false);
    expect(AuditQuery.safeParse({ limit: "abc" }).success).toBe(false);
  });
});

describe("parseJson", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  function post(body: string, headers: Record<string, string> = {}) {
    return new Request("https://h.example/api/x", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  }

  it("returns data for a valid body", async () => {
    const r = await parseJson(post(JSON.stringify({ propertyId: "m1" })), Dispatch);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.propertyId).toBe("m1");
  });

  it("rejects wrong content-type, invalid JSON, schema failures and oversized bodies", async () => {
    const wrongCt = await parseJson(post("{}", { "content-type": "text/plain" }), Dispatch);
    expect(wrongCt.ok).toBe(false);
    if (!wrongCt.ok) expect(wrongCt.res.status).toBe(415);

    const badJson = await parseJson(post("{nope"), Dispatch);
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.res.status).toBe(400);

    const schema = await parseJson(post(JSON.stringify({ propertyId: "m1", extra: 1 })), Dispatch);
    expect(schema.ok).toBe(false);
    if (!schema.ok) {
      expect(schema.res.status).toBe(400);
      const body = await schema.res.json();
      expect(body.issues.length).toBeGreaterThan(0);
    }

    const big = await parseJson(post(JSON.stringify({ propertyId: "m".repeat(5000) })), Dispatch, {
      maxBytes: 1024,
    });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.res.status).toBe(413);
  });
});
