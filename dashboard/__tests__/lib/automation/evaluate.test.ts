import { describe, expect, it } from "vitest";
import { conditionMet, num, selectFiringRules } from "@/lib/automation/evaluate";
import { AUTO_FLAG_CONFIDENCE, DISTRESS_THRESHOLD_DAYS } from "@/lib/constants";
import type { AutomationRule } from "@/lib/ops-types";

function rule(overrides: Partial<AutomationRule>): AutomationRule {
  return {
    id: "r1",
    name: "test",
    triggerType: "scan_processed",
    triggerConfig: {},
    actionType: "notify",
    actionConfig: {},
    enabled: true,
    lastFiredAt: null,
    fireCount: 0,
    ...overrides,
  };
}

describe("conditionMet", () => {
  const scan75 = rule({ triggerType: "scan_processed", triggerConfig: { min_confidence: 75 } });

  it("scan_processed compares vacancy_confidence >= min_confidence", () => {
    expect(conditionMet(scan75, { vacancy_confidence: 74 })).toBe(false);
    expect(conditionMet(scan75, { vacancy_confidence: 75 })).toBe(true);
    expect(conditionMet(scan75, { vacancy_confidence: 76 })).toBe(true);
  });

  it("distress_threshold compares days_distressed >= min_days", () => {
    const r = rule({ triggerType: "distress_threshold", triggerConfig: { min_days: 60 } });
    expect(conditionMet(r, { days_distressed: 59 })).toBe(false);
    expect(conditionMet(r, { days_distressed: 60 })).toBe(true);
  });

  it("mission_completed is always true", () => {
    const r = rule({ triggerType: "mission_completed" });
    expect(conditionMet(r, {})).toBe(true);
    expect(conditionMet(r, { anything: "at all" })).toBe(true);
  });

  it("verdict_recorded matches the configured verdict, or any when blank", () => {
    const only = rule({
      triggerType: "verdict_recorded",
      triggerConfig: { verdict: "verified_vacant" },
    });
    expect(conditionMet(only, { verdict: "verified_vacant" })).toBe(true);
    expect(conditionMet(only, { verdict: "occupied" })).toBe(false);
    expect(conditionMet(only, {})).toBe(false);
    const any = rule({ triggerType: "verdict_recorded", triggerConfig: {} });
    expect(conditionMet(any, { verdict: "occupied" })).toBe(true);
    expect(conditionMet(any, {})).toBe(true);
  });

  it("stage_changed matches the stage entered, or any when blank", () => {
    const only = rule({ triggerType: "stage_changed", triggerConfig: { stage: "under_contract" } });
    expect(conditionMet(only, { stage: "under_contract" })).toBe(true);
    expect(conditionMet(only, { stage: "outreach" })).toBe(false);
    expect(conditionMet(only, { stage: 42 })).toBe(false);
    expect(conditionMet(rule({ triggerType: "stage_changed" }), { stage: "outreach" })).toBe(true);
  });

  it("missing config falls back to the shared constants", () => {
    const scan = rule({ triggerType: "scan_processed", triggerConfig: {} });
    expect(conditionMet(scan, { vacancy_confidence: AUTO_FLAG_CONFIDENCE - 1 })).toBe(false);
    expect(conditionMet(scan, { vacancy_confidence: AUTO_FLAG_CONFIDENCE })).toBe(true);
    const distress = rule({ triggerType: "distress_threshold", triggerConfig: {} });
    expect(conditionMet(distress, { days_distressed: DISTRESS_THRESHOLD_DAYS - 1 })).toBe(false);
    expect(conditionMet(distress, { days_distressed: DISTRESS_THRESHOLD_DAYS })).toBe(true);
  });

  it("treats non-numeric payload values as 0", () => {
    expect(conditionMet(scan75, { vacancy_confidence: "high" })).toBe(false);
    expect(conditionMet(scan75, { vacancy_confidence: null })).toBe(false);
    expect(conditionMet(scan75, {})).toBe(false);
    const zero = rule({ triggerType: "scan_processed", triggerConfig: { min_confidence: 0 } });
    expect(conditionMet(zero, { vacancy_confidence: "nope" })).toBe(true);
  });

  it("accepts numeric strings", () => {
    expect(conditionMet(scan75, { vacancy_confidence: "80" })).toBe(true);
  });
});

describe("num", () => {
  it("coerces and falls back", () => {
    expect(num("12")).toBe(12);
    expect(num(undefined, 7)).toBe(7);
    expect(num("", 3)).toBe(3);
    expect(num(NaN, 5)).toBe(5);
    expect(num({}, 1)).toBe(1);
  });
});

describe("selectFiringRules", () => {
  const rules: AutomationRule[] = [
    rule({ id: "a", triggerType: "scan_processed", triggerConfig: { min_confidence: 75 } }),
    rule({ id: "b", triggerType: "scan_processed", triggerConfig: { min_confidence: 90 } }),
    rule({ id: "c", triggerType: "scan_processed", enabled: false }),
    rule({ id: "d", triggerType: "distress_threshold", triggerConfig: { min_days: 1 } }),
  ];

  it("skips disabled and mismatched-trigger rules", () => {
    const { candidates, firing } = selectFiringRules(rules, "scan_processed", {
      vacancy_confidence: 80,
    });
    expect(candidates.map((r) => r.id)).toEqual(["a", "b"]);
    expect(firing.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns no candidates for a trigger nobody listens to", () => {
    const { candidates, firing } = selectFiringRules(rules, "mission_completed", {});
    expect(candidates).toEqual([]);
    expect(firing).toEqual([]);
  });
});
