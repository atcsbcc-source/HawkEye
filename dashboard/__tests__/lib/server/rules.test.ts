import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RULE_IDS, evaluateRules, listRules, setRuleEnabled } from "@/lib/server/rules";
import { listEvents } from "@/lib/server/audit";
import { mockGetProperty, resetMockStore } from "@/lib/server/mock-store";
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
});
