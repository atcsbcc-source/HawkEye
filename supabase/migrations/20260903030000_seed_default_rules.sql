-- ============================================================================
-- HawkEye — seed the two default automation rules with fixed UUIDs.
--
-- The dashboard no longer falls back to in-memory defaults when Supabase is
-- configured (an empty table is an empty rule list), so the defaults the mock
-- mode ships are seeded here with the SAME ids the dashboard uses
-- (dashboard/lib/server/rules.ts DEFAULT_RULE_IDS).
--
-- The flag rule ships DISABLED in database mode: the `property_scans_auto_flag`
-- trigger (20260901000000_init_hawkeye_schema.sql) is the flagging authority and
-- already promotes every scan at/above 75, even while the dashboard is down.
-- Enable this rule only if you want an additional audit event per flag.
--
-- Apply only to a Supabase branch or a separate dev project — never to the
-- live project without the owner's explicit go-ahead.
-- ============================================================================

insert into public.automation_rules
  (id, name, trigger_type, trigger_config, action_type, action_config, enabled)
values
  ('00000000-0000-4000-8000-000000000001',
   'Auto-flag high-confidence vacancies',
   'scan_processed', '{"min_confidence": 75}'::jsonb,
   'flag_property', '{}'::jsonb, false),
  ('00000000-0000-4000-8000-000000000002',
   'Dispatch 60-day distressed leads to CRM',
   'distress_threshold', '{"min_days": 60}'::jsonb,
   'dispatch_webhook', '{}'::jsonb, false)
on conflict (id) do nothing;
