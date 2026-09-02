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
    expect(result.eventType).toBeUndefined();
    expect(result.detail.skipped).toBe("no database");
    expect(deps.calls).toHaveLength(0);
  });
});

describe("executeAction / notify", () => {
  it("is a no-op that succeeds", async () => {
    const result = await executeAction(rule({ actionType: "notify" }), {}, recordingDeps());
    expect(result).toEqual({ ok: true, detail: {} });
  });
});
