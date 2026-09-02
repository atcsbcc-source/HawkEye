/**
 * Barrel for the server-side ops layer. API routes import from here; the
 * implementation is split across:
 *
 *   state.ts      globalThis singleton + adapter factory
 *   missions.ts   in-process mission queue fronting the drone adapter
 *   audit.ts      append-only audit events (memory + Supabase)
 *   rules.ts      automation rule store + evaluateRules orchestration
 *   db.ts         DbError / must() — no Supabase write may swallow an error
 *   ../automation/evaluate.ts  pure condition evaluation
 *   ../automation/actions.ts   dependency-injected action executor
 *
 * Every name exported below keeps its pre-split signature.
 */
export {
  getAdapter,
  listMissions,
  createMission,
  launchMission,
  abortMission,
  syncMissionProgress,
  MissionQueueFullError,
} from "./missions";
export { pushEvent, listEvents } from "./audit";
export type { AuditInput } from "./audit";
export { listRules, createRule, setRuleEnabled, recordRuleFired, evaluateRules } from "./rules";
export type { EvaluationResult, EvaluateOptions, RuleOutcome } from "./rules";
export { DbError } from "./db";
