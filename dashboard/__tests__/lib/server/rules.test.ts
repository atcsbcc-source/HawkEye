import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RULE_IDS, evaluateRules, listRules, setRuleEnabled } from "@/lib/server/rules";
import { listEvents } from "@/lib/server/audit";
import { mockGetProperty, mockListOpenTasks, resetMockStore } from "@/lib/server/mock-store";
import { resetOpsState } from "@/lib/server/state";

// Force mock mode regardless of the developer's shell.
const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  crm: process.env.CRM_WEBHOOK_URL,
};

describe("evaluateRules (mock mode)", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CRM_WEBHOOK_URL;
    resetOpsState();
    resetMockStore();
  });
  afterAll(() => {
    resetOpsState();
    resetMockStore();
    if (saved.url) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.anon) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.anon;
    if (saved.service) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.service;
    if (saved.crm) process.env.CRM_WEBHOOK_URL = saved.crm;
  });

  it("a dispatch_webhook rule with no URL is a failed outcome, not a firing", async () => {
    await setRuleEnabled(DEFAULT_RULE_IDS.dispatch, true);
    const result = await evaluateRules("distress_threshold", {
      property_id: "m1",
      days_distressed: 90,
    });
    expect(result.matched).toBe(1);
    expect(result.fired).toEqual([]);
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        id: DEFAULT_RULE_IDS.dispatch,
        actionType: "dispatch_webhook",
        ok: false,
      }),
    ]);
    const rule = (await listRules()).find((r) => r.id === DEFAULT_RULE_IDS.dispatch)!;
    expect(rule.fireCount).toBe(0);
    const events = await listEvents();
    expect(events.some((e) => e.eventType === "webhook.failed")).toBe(true);
  });

  it("`only` restricts evaluation to the pending rule ids", async () => {
    await setRuleEnabled(DEFAULT_RULE_IDS.dispatch, true);
    const result = await evaluateRules(
      "distress_threshold",
      { property_id: "m1", days_distressed: 90 },
      { only: [] },
    );
    expect(result.matched).toBe(0);
    expect(result.outcomes).toEqual([]);
  });

  it("flag_property flags the mock parcel and audits property.flagged", async () => {
    expect(mockGetProperty("m5")?.status).toBe("active");
    const result = await evaluateRules("scan_processed", {
      property_id: "m5",
      vacancy_confidence: 88,
    });
    expect(result.fired).toEqual(["Auto-flag high-confidence vacancies"]);
    const lead = mockGetProperty("m5")!;
    expect(lead.status).toBe("flagged");
    expect(lead.first_flagged_at).not.toBeNull();
    const events = await listEvents();
    expect(events.some((e) => e.eventType === "property.flagged" && e.subjectId === "m5")).toBe(
      true,
    );
  });

  it("re-flagging an already flagged / unknown / snoozed parcel is a skipped no-op", async () => {
    const payload = { property_id: "m5", vacancy_confidence: 90 };
    await evaluateRules("scan_processed", payload);
    const second = await evaluateRules("scan_processed", payload);
    expect(second.fired).toEqual([]);
    expect(second.outcomes).toEqual([expect.objectContaining({ ok: true, skipped: true })]);

    const unknown = await evaluateRules("scan_processed", { ...payload, property_id: "zzz" });
    expect(unknown.fired).toEqual([]);
    expect(unknown.outcomes[0].skipped).toBe(true);

    const rule = (await listRules()).find((r) => r.id === DEFAULT_RULE_IDS.flag)!;
    expect(rule.fireCount).toBe(1);
    const events = await listEvents();
    expect(events.filter((e) => e.eventType === "property.flagged")).toHaveLength(1);
    expect(events.filter((e) => e.eventType === "rule.fired")).toHaveLength(1);
  });

  it("mock mode never delivers a webhook even when CRM_WEBHOOK_URL is set", async () => {
    process.env.CRM_WEBHOOK_URL = "https://hooks.zapier.com/hooks/catch/1/review";
    await setRuleEnabled(DEFAULT_RULE_IDS.dispatch, true);
    const result = await evaluateRules("distress_threshold", {
      property_id: "m1",
      days_distressed: 94,
    });
    expect(result.fired).toEqual([]);
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        ok: false,
        kind: "mock_mode",
        error: expect.stringMatching(/mock/),
      }),
    ]);
    const events = await listEvents();
    expect(events.some((e) => e.eventType === "webhook.delivered")).toBe(false);
    expect(events.some((e) => e.eventType === "webhook.failed")).toBe(true);
  });

  it("a verified_vacant verdict moves the parcel to Verified and opens the skip-trace task", async () => {
    expect(mockGetProperty("m3")!.crm_stage).toBe("new");
    const result = await evaluateRules("verdict_recorded", {
      property_id: "m3",
      verdict: "verified_vacant",
    });
    expect(result.matched).toBe(2);
    expect(result.fired.sort()).toEqual([
      "Verified vacant → Verified stage",
      "Verified vacant → open skip-trace task",
    ]);
    expect(mockGetProperty("m3")!.crm_stage).toBe("verified");
    const task = mockListOpenTasks().find((t) => t.property_id === "m3");
    expect(task?.body).toMatch(/skip-trace/i);
    expect(task?.created_by).toBe(`rule:${DEFAULT_RULE_IDS.verifiedTask}`);
    const events = await listEvents();
    expect(events.filter((e) => e.eventType === "property.stage_changed")).toHaveLength(1);
    expect(events.find((e) => e.eventType === "task.created")).toMatchObject({
      subjectType: "property",
      subjectId: "m3",
    });

    // Re-recording the same verdict is a no-op: stage unchanged, no second task.
    const again = await evaluateRules("verdict_recorded", {
      property_id: "m3",
      verdict: "verified_vacant",
    });
    expect(again.fired).toEqual([]);
    expect(again.outcomes.every((o) => o.skipped)).toBe(true);
    expect(mockListOpenTasks().filter((t) => t.property_id === "m3")).toHaveLength(1);
  });

  it("other verdicts leave the pipeline alone", async () => {
    const result = await evaluateRules("verdict_recorded", {
      property_id: "m3",
      verdict: "occupied",
    });
    expect(result.matched).toBe(2);
    expect(result.fired).toEqual([]);
    expect(result.outcomes).toEqual([]);
    expect(mockGetProperty("m3")!.crm_stage).toBe("new");
  });
});
