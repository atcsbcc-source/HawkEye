-- ============================================================================
-- HawkEye — least-privilege hardening (SEC-05)
--
-- NOT applied to the live project (vsrrmqipgomrgxnkcfof). Apply to a Supabase
-- branch or a separate dev project first; apply before
-- 20260903020000_properties_verifications_firings and
-- 20260903030000_seed_default_rules.
--
-- Guarded with if exists / if not exists so a re-run is safe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- properties: signed-in operators get NO direct write path. Every status /
-- notes / verification change goes through the validated API routes with the
-- service role, which enforce the dispatch verdict gate, the sweep ledger and
-- the audit stream — a PostgREST UPDATE with the anon key + a session JWT
-- would bypass all three. (The browser client is only used by the auth
-- screens; lib/supabase.ts writes are service-role.)
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated update property status" on public.properties;
drop policy if exists "authenticated update lead status/notes" on public.properties;

revoke update on public.properties from authenticated;

-- ----------------------------------------------------------------------------
-- anon has no business in this schema (RLS already blocks it; remove the
-- default grants too so a policy slip cannot expose anything).
-- REVOKE on objects owned by other roles (e.g. PostGIS spatial_ref_sys) only
-- warns; that is expected.
-- ----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
-- Supabase's default privileges are defined FOR ROLE postgres (the migration
-- runner); an unqualified ALTER DEFAULT PRIVILEGES would only bind to the
-- executing role, so name it explicitly. Future tables then start with no
-- anon grants and read-only grants for authenticated.
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;

-- ----------------------------------------------------------------------------
-- authenticated never inserts/deletes directly; writes go through the
-- validated API routes using the service role.
-- ----------------------------------------------------------------------------
revoke insert, delete on
  public.properties,
  public.flights,
  public.property_scans,
  public.missions,
  public.automation_rules,
  public.audit_events
from authenticated;
revoke update on
  public.flights,
  public.property_scans,
  public.missions,
  public.automation_rules,
  public.audit_events
from authenticated;

-- ----------------------------------------------------------------------------
-- audit_events is append-only, even for the service role.
-- ----------------------------------------------------------------------------
create or replace function public.audit_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists audit_events_no_mutation on public.audit_events;
create trigger audit_events_no_mutation
  before update or delete on public.audit_events
  for each row execute function public.audit_events_immutable();

revoke execute on function public.audit_events_immutable() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Provenance columns.
-- ----------------------------------------------------------------------------
alter table public.automation_rules
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists automation_rules_set_updated_at on public.automation_rules;
create trigger automation_rules_set_updated_at
  before update on public.automation_rules
  for each row execute function public.set_updated_at();

alter table public.audit_events
  add column if not exists actor_user_id uuid;

create index if not exists audit_events_actor_user_idx
  on public.audit_events (actor_user_id)
  where actor_user_id is not null;

-- ----------------------------------------------------------------------------
-- Size checks so a bad row fails loudly instead of bloating the table.
-- ----------------------------------------------------------------------------
alter table public.audit_events
  drop constraint if exists audit_detail_size,
  add constraint audit_detail_size check (pg_column_size(detail) < 16384);

alter table public.automation_rules
  drop constraint if exists rule_name_len,
  add constraint rule_name_len check (length(name) between 1 and 80),
  drop constraint if exists rule_config_size,
  add constraint rule_config_size check (
    pg_column_size(trigger_config) < 4096 and pg_column_size(action_config) < 4096
  );

alter table public.properties
  drop constraint if exists properties_notes_len,
  add constraint properties_notes_len check (coalesce(length(notes), 0) <= 2000);

alter table public.missions
  drop constraint if exists missions_name_len,
  add constraint missions_name_len check (length(name) between 1 and 80);

-- ----------------------------------------------------------------------------
-- Storage hygiene: cap imagery uploads.
-- ----------------------------------------------------------------------------
update storage.buckets
   set file_size_limit    = 10485760,               -- 10 MiB
       allowed_mime_types = array['image/jpeg', 'image/png']
 where id = 'property-scans';

-- Re-assert the read grants the dashboard relies on (idempotent).
grant select on
  public.properties,
  public.flights,
  public.property_scans,
  public.missions,
  public.automation_rules,
  public.audit_events,
  public.distressed_properties
to authenticated;
