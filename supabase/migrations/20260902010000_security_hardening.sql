-- ============================================================================
-- HawkEye — security hardening (from Supabase advisor findings)
-- Already applied to project vsrrmqipgomrgxnkcfof via MCP; kept here so the
-- repo's migration history matches the live database.
-- ============================================================================

-- Views default to SECURITY DEFINER on Postgres; make the dashboard view
-- respect the querying user's RLS instead of the owner's.
alter view public.distressed_properties set (security_invoker = true);

-- Pin function search paths so they can't be hijacked by role-level settings.
alter function public.set_updated_at()             set search_path = '';
alter function public.auto_flag_property()         set search_path = '';
alter function public.log_property_status_change() set search_path = '';
alter function public.log_scan_ingested()          set search_path = '';

-- PostGIS ships st_estimatedextent as SECURITY DEFINER with EXECUTE granted
-- to PUBLIC; API roles don't need it.
revoke execute on function public.st_estimatedextent(text, text) from public, anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text) from public, anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text, boolean) from public, anon, authenticated;