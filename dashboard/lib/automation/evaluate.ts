/**
 * Pure rule evaluation — no server, network or Supabase imports so it can be
 * unit-tested and reused by the pipeline-facing evaluate route alike.
 */
import { AUTO_FLAG_CONFIDENCE, DISTRESS_THRESHOLD_DAYS } from "../constants";
import type { AutomationRule, TriggerType } from "../ops-types";

/** Coerce a payload/config value to a number; anything non-numeric counts as 0. */
export function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce to a trimmed string; non-strings count as "". */
export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Does the trigger payload satisfy the rule's condition? */
export function conditionMet(rule: AutomationRule, payload: Record<string, unknown>): boolean {
  switch (rule.triggerType) {
    case "scan_processed": {
      const min = num(rule.triggerConfig.min_confidence, AUTO_FLAG_CONFIDENCE);
      return num(payload.vacancy_confidence) >= min;
    }
    case "distress_threshold": {
      const minDays = num(rule.triggerConfig.min_days, DISTRESS_THRESHOLD_DAYS);
      return num(payload.days_distressed) >= minDays;
    }
    case "mission_completed":
      return true;
    case "verdict_recorded": {
      // Blank config = any verdict; otherwise the verdict must match exactly.
      const want = str(rule.triggerConfig.verdict);
      return want === "" || want === str(payload.verdict);
    }
    case "stage_changed": {
      const want = str(rule.triggerConfig.stage);
      return want === "" || want === str(payload.stage);
    }
    default:
      return false;
  }
}

/** Enabled rules bound to `trigger` (candidates), and the subset whose condition holds. */
export function selectFiringRules(
  rules: AutomationRule[],
  trigger: TriggerType,
  payload: Record<string, unknown>,
): { candidates: AutomationRule[]; firing: AutomationRule[] } {
  const candidates = rules.filter((r) => r.enabled && r.triggerType === trigger);
  const firing = candidates.filter((r) => conditionMet(r, payload));
  return { candidates, firing };
}
