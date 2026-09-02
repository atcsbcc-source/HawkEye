/**
 * Product thresholds shared by the dashboard, the automation engine and the
 * simulator. Import from here instead of repeating literals.
 *
 * The one copy that cannot import this file is the Postgres auto-flag trigger
 * (`flag_threshold constant integer := 75` in
 * supabase/migrations/20260901000000_init_hawkeye_schema.sql, ~line 116).
 * The trigger is the flagging authority — it fires even when the dashboard is
 * down — so changing AUTO_FLAG_CONFIDENCE also requires a NEW migration that
 * `create or replace`s public.auto_flag_property() with the same value.
 */

/** Scan confidence at/above which a property is flagged (DB trigger + rule default). */
export const AUTO_FLAG_CONFIDENCE = 75;
/** Confidence at/above which the UI renders the amber "worth a look" band. */
export const CONFIDENCE_WARN = 50;
/** Days flagged before a lead is considered distressed (view + default rule). */
export const DISTRESS_THRESHOLD_DAYS = 60;
/** Telemetry rail warning thresholds. */
export const LOW_BATTERY_PCT = 25;
export const LOW_LINK_PCT = 60;
/** Audit stream: rows fetched for the feed, and rows kept in memory (mock mode). */
export const AUDIT_FEED_LIMIT = 60;
export const AUDIT_MEMORY_CAP = 500;
