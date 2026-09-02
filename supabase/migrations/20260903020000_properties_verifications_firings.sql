-- ============================================================================
-- HawkEye — properties management, verification verdicts, rule firings
--
-- NOT yet applied to the live project. Apply in order after
-- 20260903010000_least_privilege and only to a Supabase branch / dev project.
--
--   * properties gains neighborhood, archived_at (soft delete) and the
--     operator's verification verdict + snooze window
--   * property_verifications — audited ground truth, one row per verdict
--   * automation_rule_firings — idempotency ledger for the distress sweep
--   * auto_flag_property() no longer re-flags a snoozed false positive
--   * distressed_properties re-exposes the new columns and hides archived rows
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Verdict enum
-- ----------------------------------------------------------------------------
create type public.verification_verdict as enum
  ('verified_vacant', 'false_positive', 'occupied', 'needs_recheck');

-- ----------------------------------------------------------------------------
-- properties — new nullable columns (additive; existing rows unaffected)
-- ----------------------------------------------------------------------------
alter table public.properties
  add column if not exists neighborhood  text,
  add column if not exists archived_at   timestamptz,
  add column if not exists verification  public.verification_verdict,
  add column if not exists verified_at   timestamptz,
  add column if not exists snoozed_until timestamptz;

create index if not exists properties_neighborhood_idx on public.properties (neighborhood);
create index if not exists properties_archived_idx     on public.properties (archived_at)
  where archived_at is not null;

-- Backfill neighborhood from the flight polygons that already cover the parcel.
update public.properties p
   set neighborhood = f.neighborhood
  from public.flights f
 where p.neighborhood is null
   and f.coverage_polygon is not null
   and st_contains(f.coverage_polygon, p.location::geometry);

-- ----------------------------------------------------------------------------
-- property_verifications — operator ground truth (calibration input)
-- ----------------------------------------------------------------------------
create table public.property_verifications (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  scan_id     uuid references public.property_scans (id) on delete set null,
  verdict     public.verification_verdict not null,
  note        text check (note is null or length(note) <= 2000),
  verified_by text,
  created_at  timestamptz not null default now()
);

create index property_verifications_property_idx
  on public.property_verifications (property_id, created_at desc);

alter table public.property_verifications enable row level security;

create policy "authenticated read property_verifications"
  on public.property_verifications for select to authenticated using (true);
-- Writes go through the service role (POST /api/properties/[id]/verify).

-- Every verdict lands in the audit stream.
create or replace function public.log_property_verified()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.audit_events (actor, event_type, subject_type, subject_id, detail)
  values (coalesce(new.verified_by, 'operator'), 'property.verified', 'property',
          new.property_id::text,
          jsonb_build_object('verdict', new.verdict,
                             'scan_id', new.scan_id,
                             'verification_id', new.id));
  return new;
end $$;

create trigger property_verifications_audit_insert
  after insert on public.property_verifications
  for each row execute function public.log_property_verified();

-- ----------------------------------------------------------------------------
-- automation_rule_firings — one row per (rule, subject); the sweep skips
-- subjects already present so a lead is never dispatched twice.
-- ----------------------------------------------------------------------------
create table public.automation_rule_firings (
  rule_id      uuid not null references public.automation_rules (id) on delete cascade,
  subject_type text not null,
  subject_id   text not null,
  fired_at     timestamptz not null default now(),
  primary key (rule_id, subject_type, subject_id)
);

alter table public.automation_rule_firings enable row level security;

create policy "authenticated read automation_rule_firings"
  on public.automation_rule_firings for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- auto_flag_property — identical to 20260901 except it respects a snoozed
-- false-positive verdict (the operator said "not vacant"; do not re-flag for
-- the snooze window even if confidence stays high).
-- ----------------------------------------------------------------------------
create or replace function public.auto_flag_property()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  flag_threshold constant integer := 75;
begin
  if new.vacancy_confidence >= flag_threshold then
    update public.properties
       set status           = case when status = 'dispatched' then status else 'flagged' end,
           first_flagged_at = coalesce(first_flagged_at, now())
     where id = new.property_id
       and not (verification = 'false_positive'
                and snoozed_until is not null
                and snoozed_until > now());
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- distressed_properties — same columns as before plus neighborhood /
-- verification / verified_at; archived parcels drop out of the dashboard.
-- ----------------------------------------------------------------------------
drop view if exists public.distressed_properties;

create view public.distressed_properties
with (security_invoker = true) as
select
  p.id,
  p.parcel_id,
  p.address,
  p.lat,
  p.lng,
  p.status,
  p.first_flagged_at,
  p.notes,
  p.neighborhood,
  p.verification,
  p.verified_at,
  extract(day from now() - p.first_flagged_at)::int as days_distressed,
  ls.vacancy_confidence  as latest_vacancy_confidence,
  ls.lawn_growth_index   as latest_lawn_growth_index,
  ls.vehicle_present     as latest_vehicle_present,
  ls.vehicle_static      as latest_vehicle_static,
  ls.image_url_current   as latest_image_url,
  ls.flown_at            as latest_scan_at
from public.properties p
left join lateral (
  select s.*, f.flown_at
  from public.property_scans s
  join public.flights f on f.id = s.flight_id
  where s.property_id = p.id
  order by f.flown_at desc
  limit 1
) ls on true
where p.first_flagged_at is not null
  and p.archived_at is null;

grant select on public.distressed_properties to authenticated;
