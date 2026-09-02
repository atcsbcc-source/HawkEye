import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeAction, type ActionDeps } from "@/lib/automation/actions";
import type { AutomationRule } from "@/lib/ops-types";

function rule(overrides: Partial<AutomationRule>): AutomationRule {
  return {
    id: "r1",
    name: "Dispatch leads",
    triggerType: "distress_threshold",
    triggerConfig: {},
    actionType: "dispatch_webhook",
    actionConfig: { url: "https://crm.example.test/hook" },
    enabled: true,
    lastFiredAt: null,
    fireCount: 0,
    ...overrides,
  };
}

interface Call {
  url: string;
  body: unknown;
}

function recordingDeps(status = 200, fail?: Error): ActionDeps & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    db: null,
    postJson: async (url, body) => {
      calls.push({ url, body });
      if (fail) throw fail;
      return { status };
    },
  };
}

describe("executeAction / dispatch_webhook", () => {
  const savedEnv = process.env.CRM_WEBHOOK_URL;
  beforeEach(() => {
    delete process.env.CRM_WEBHOOK_URL;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CRM_WEBHOOK_URL;
    else process.env.CRM_WEBHOOK_URL = savedEnv;
  });

  it("posts exactly once with the rule name and payload", async () => {
    const deps = recordingDeps(202);
    const payload = { property_id: "p1", days_distressed: 61 };
    const result = await executeAction(rule({}), payload, deps);

    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0].url).toBe("https://crm.example.test/hook");
    expect(deps.calls[0].body).toEqual({
      source: "hawkeye-automation",
      rule: "Dispatch leads",
      payload,
    });
    expect(result.ok).toBe(true);
    expect(result.eventType).toBe("webhook.delivered");
    expect(result.detail.status).toBe(202);
    expect(typeof result.detail.ms).toBe("number");
  });

  it("reports a non-2xx response as webhook.failed without throwing", async () => {
    const deps = recordingDeps(500);
    const result = await executeAction(rule({}), {}, deps);
    expect(result.ok).toBe(false);
    expect(result.eventType).toBe("webhook.failed");
    expect(result.detail.status).toBe(500);
  });

  it("reports a network failure instead of throwing", async () => {
    const deps = recordingDeps(200, new Error("ECONNREFUSED"));
    const result = await executeAction(rule({}), {}, deps);
    expect(result.ok).toBe(false);
    expect(result.eventType).toBe("webhook.failed");
    expect(result.detail.error).toContain("ECONNREFUSED");
  });

  it("falls back to CRM_WEBHOOK_URL and fails cleanly when nothing is configured", async () => {
    const none = recordingDeps();
    const unconfigured = await executeAction(rule({ actionConfig: {} }), {}, none);
    expect(unconfigured.ok).toBe(false);
    expect(none.calls).toHaveLength(0);

    process.env.CRM_WEBHOOK_URL = "https://env.example.test/hook";
    const env = recordingDeps();
    await executeAction(rule({ actionConfig: {} }), {}, env);
    expect(env.calls[0].url).toBe("https://env.example.test/hook");
  });
});

describe("executeAction / flag_property", () => {
  it("does nothing without a database", async () => {
    const deps = recordingDeps();
    const result = await executeAction(
      rule({ actionType: "flag_property", triggerType: "scan_processed" }),
      { property_id: "p1", vacancy_confidence: 99 },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.eventType).toBeUndefined();
    expect(result.detail.skipped).toBe("no database");
    expect(deps.calls).toHaveLength(0);
  });

  it("reports a store-backed no-op as skipped and a transition as a firing", async () => {
    const flagRule = rule({ actionType: "flag_property", triggerType: "scan_processed" });
    const payload = { property_id: "p1", vacancy_confidence: 99 };

    const already = await executeAction(flagRule, payload, {
      ...recordingDeps(),
      flagWithoutDb: () => "already_flagged",
    });
    expect(already).toMatchObject({
      ok: true,
      skipped: true,
      detail: { skipped: "already flagged" },
    });
    expect(already.eventType).toBeUndefined();

    const unknown = await executeAction(flagRule, payload, {
      ...recordingDeps(),
      flagWithoutDb: () => "not_flaggable",
    });
    expect(unknown).toMatchObject({
      ok: true,
      skipped: true,
      detail: { skipped: "not flaggable" },
    });

    const flagged = await executeAction(flagRule, payload, {
      ...recordingDeps(),
      flagWithoutDb: () => "flagged",
    });
    expect(flagged.ok).toBe(true);
    expect(flagged.skipped).toBeUndefined();
    expect(flagged.eventType).toBe("property.flagged");
  });
});

describe("executeAction / notify", () => {
  it("is a no-op that succeeds", async () => {
    const result = await executeAction(rule({ actionType: "notify" }), {}, recordingDeps());
    expect(result).toEqual({ ok: true, detail: {} });
  });
});

describe("executeAction / set_stage + create_task (mock deps)", () => {
  const base = { db: null, postJson: async () => ({ status: 200 }) };

  it("set_stage moves the parcel and reports unchanged / not found as skips", async () => {
    const calls: [string, string, string][] = [];
    const deps: ActionDeps = {
      ...base,
      setStageWithoutDb: (id, stage, by) => {
        calls.push([id, stage, by]);
        return id === "p1" ? "changed" : id === "p2" ? "unchanged" : "not_found";
      },
    };
    const r = rule({ id: "rs", actionType: "set_stage", actionConfig: { stage: "verified" } });
    expect(await executeAction(r, { property_id: "p1" }, deps)).toMatchObject({
      ok: true,
      eventType: "property.stage_changed",
      detail: { property_id: "p1", stage: "verified" },
    });
    expect(calls).toEqual([["p1", "verified", "rule:rs"]]);
    expect(await executeAction(r, { property_id: "p2" }, deps)).toMatchObject({
      ok: true,
      skipped: true,
    });
    expect(await executeAction(r, { property_id: "p3" }, deps)).toMatchObject({
      ok: true,
      skipped: true,
    });
    expect(await executeAction(r, {}, deps)).toMatchObject({ skipped: true });
  });

  it("set_stage rejects an unknown stage and needs a mock setter without a db", async () => {
    const bad = rule({ actionType: "set_stage", actionConfig: { stage: "sold" } });
    expect(await executeAction(bad, { property_id: "p1" }, base)).toMatchObject({ ok: false });
    const ok = rule({ actionType: "set_stage", actionConfig: { stage: "outreach" } });
    expect(await executeAction(ok, { property_id: "p1" }, base)).toMatchObject({ skipped: true });
  });

  it("create_task opens a task due in due_in_days (default 3)", async () => {
    const created: { id: string; title: string; dueAt: string; by: string }[] = [];
    const deps: ActionDeps = {
      ...base,
      createTaskWithoutDb: (id, title, dueAt, by) => {
        created.push({ id, title, dueAt, by });
        return id === "ghost" ? "not_found" : id === "dup" ? "exists" : "created";
      },
    };
    const r = rule({
      id: "rt",
      actionType: "create_task",
      actionConfig: { title: "Skip-trace", due_in_days: 5 },
    });
    const before = Date.now();
    const res = await executeAction(r, { property_id: "p1" }, deps);
    expect(res).toMatchObject({
      ok: true,
      eventType: "task.created",
      detail: { title: "Skip-trace" },
    });
    const due = Date.parse(created[0].dueAt);
    expect(due - before).toBeGreaterThanOrEqual(5 * 86_400_000 - 1000);
    expect(due - before).toBeLessThan(5 * 86_400_000 + 5000);
    expect(created[0].by).toBe("rule:rt");

    const dflt = rule({ actionType: "create_task", actionConfig: { title: "Call" } });
    await executeAction(dflt, { property_id: "p1" }, deps);
    expect(Date.parse(created[1].dueAt) - before).toBeGreaterThanOrEqual(3 * 86_400_000 - 1000);

    expect(await executeAction(r, { property_id: "ghost" }, deps)).toMatchObject({ skipped: true });
    expect(await executeAction(r, { property_id: "dup" }, deps)).toMatchObject({
      skipped: true,
      detail: { skipped: "task already open" },
    });
    const untitled = rule({ actionType: "create_task", actionConfig: {} });
    expect(await executeAction(untitled, { property_id: "p1" }, deps)).toMatchObject({ ok: false });
  });
});
