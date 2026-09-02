-- ============================================================================
-- HawkEye — built-in CRM + workflow
--
--   * properties gain the deal pipeline: crm_stage, priority, assignee, owner
--     name, next action (+ due), deal numbers (asking / offer / ARV / repairs)
--     and free-form tags
--   * contacts — owners, heirs, tenants, agents… per parcel, with a
--     do-not-contact flag
--   * activities — the timeline: notes, calls, texts, emails, mailers, site
--     visits, offers, stage changes and tasks (kind = 'task' + due_at;
--     completed_at marks it done)
--   * automation_rules accepts the new workflow triggers
--     (verdict_recorded, stage_changed) and actions (set_stage, create_task);
--     two default rules move a verified-vacant parcel into the pipeline
--   * distressed_properties re-exposes the CRM columns
--
-- Guarded with if exists / if not exists so a re-run is safe. Apply after
-- 20260903040000_intel_scoring.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$
begin
  create type public.crm_stage as enum (
    'new', 'verified', 'researching', 'outreach', 'negotiating',
    'under_contract', 'closed_won', 'closed_lost'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.contact_role as enum (
    'owner', 'heir', 'tenant', 'relative', 'agent', 'attorney', 'neighbor', 'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.activity_kind as enum (
    'note', 'call', 'text', 'email', 'mailer', 'visit', 'offer', 'stage_change', 'task'
  );
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- properties — pipeline + deal columns (additive)
-- ----------------------------------------------------------------------------
alter table public.properties
  add column if not exists crm_stage        public.crm_stage not null default 'new',
  add column if not exists stage_changed_at timestamptz,
  add column if not exists priority         text not null default 'normal'
                                            check (priority in ('low', 'normal', 'high')),
  add column if not exists assigned_to      text check (assigned_to is null or length(assigned_to) <= 80),
  add column if not exists owner_name       text check (owner_name is null or length(owner_name) <= 120),
  add column if not exists next_action      text check (next_action is null or length(next_action) <= 200),
  add column if not exists next_action_at   timestamptz,
  add column if not exists asking_price     numeric(12,2) check (asking_price is null or asking_price >= 0),
  add column if not exists offer_price      numeric(12,2) check (offer_price is null or offer_price >= 0),
  add column if not exists arv              numeric(12,2) check (arv is null or arv >= 0),
  add column if not exists repair_estimate  numeric(12,2) check (repair_estimate is null or repair_estimate >= 0),
  add column if not exists tags             text[] not null default '{}';

create index if not exists properties_crm_stage_idx on public.properties (crm_stage)
  where archived_at is null;
create index if not exists properties_next_action_idx on public.properties (next_action_at)
  where next_action_at is not null and archived_at is null;

-- Parcels an operator already confirmed vacant start in the pipeline, not at `new`.
update public.properties
   set crm_stage = 'verified', stage_changed_at = coalesce(verified_at, now())
 where crm_stage = 'new'
   and verification = 'verified_vacant';

-- ----------------------------------------------------------------------------
-- contacts
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table if not exists public.contacts (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references public.properties (id) on delete cascade,
  name              text not null check (length(name) between 1 and 120),
  role              public.contact_role not null default 'other',
  phone             text check (phone is null or length(phone) <= 40),
  email             text check (email is null or length(email) <= 254),
  mailing_address   text check (mailing_address is null or length(mailing_address) <= 300),
  preferred_channel text check (preferred_channel is null
                                or preferred_channel in ('phone', 'text', 'email', 'mail')),
  do_not_contact    boolean not null default false,
  source            text check (source is null or length(source) <= 80),
  notes             text check (notes is null or length(notes) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists contacts_property_idx on public.contacts (property_id, created_at);

drop trigger if exists contacts_touch_updated_at on public.contacts;
create trigger contacts_touch_updated_at
  before update on public.contacts
  for each row execute function public.touch_updated_at();

alter table public.contacts enable row level security;

drop policy if exists "authenticated read contacts" on public.contacts;
create policy "authenticated read contacts"
  on public.contacts for select to authenticated using (true);

revoke all on public.contacts from anon;
revoke insert, update, delete, truncate, references, trigger on public.contacts from authenticated;
grant select on public.contacts to authenticated;

-- ----------------------------------------------------------------------------
-- activities — timeline + tasks
-- ----------------------------------------------------------------------------
create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties (id) on delete cascade,
  contact_id   uuid references public.contacts (id) on delete set null,
  kind         public.activity_kind not null,
  body         text not null check (length(body) between 1 and 4000),
  outcome      text check (outcome is null or length(outcome) <= 120),
  amount       numeric(12,2) check (amount is null or amount >= 0),
  due_at       timestamptz,
  completed_at timestamptz,
  created_by   text,
  created_at   timestamptz not null default now(),
  -- tasks carry a due date; nothing else does
  constraint activities_task_due check (kind <> 'task' or due_at is not null),
  constraint activities_only_tasks_complete check (kind = 'task' or completed_at is null)
);

create index if not exists activities_property_idx
  on public.activities (property_id, created_at desc);
create index if not exists activities_open_tasks_idx
  on public.activities (due_at)
  where kind = 'task' and completed_at is null;

alter table public.activities enable row level security;

drop policy if exists "authenticated read activities" on public.activities;
create policy "authenticated read activities"
  on public.activities for select to authenticated using (true);

revoke all on public.activities from anon;
revoke insert, update, delete, truncate, references, trigger on public.activities from authenticated;
grant select on public.activities to authenticated;

-- ----------------------------------------------------------------------------
-- automation_rules — workflow triggers / actions
-- ----------------------------------------------------------------------------
alter table public.automation_rules
  drop constraint if exists automation_rules_trigger_type_check;
alter table public.automation_rules
  add constraint automation_rules_trigger_type_check check (trigger_type in
    ('scan_processed', 'distress_threshold', 'mission_completed',
     'verdict_recorded', 'stage_changed'));

alter table public.automation_rules
  drop constraint if exists automation_rules_action_type_check;
alter table public.automation_rules
  add constraint automation_rules_action_type_check check (action_type in
    ('flag_property', 'dispatch_webhook', 'notify', 'set_stage', 'create_task'));

-- Default workflow: a verified-vacant verdict moves the parcel to `verified`
-- and opens a skip-trace task due in three days. Same fixed ids as
-- dashboard/lib/server/rules.ts DEFAULT_RULE_IDS.
insert into public.automation_rules
  (id, name, trigger_type, trigger_config, action_type, action_config, enabled)
values
  ('00000000-0000-4000-8000-000000000003',
   'Verified vacant → Verified stage',
   'verdict_recorded', '{"verdict": "verified_vacant"}'::jsonb,
   'set_stage', '{"stage": "verified"}'::jsonb, true),
  ('00000000-0000-4000-8000-000000000004',
   'Verified vacant → open skip-trace task',
   'verdict_recorded', '{"verdict": "verified_vacant"}'::jsonb,
   'create_task', '{"title": "Skip-trace the owner and add a contact", "due_in_days": 3}'::jsonb,
   true)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- distressed_properties — plus the CRM columns
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
  p.snoozed_until,
  p.crm_stage,
  p.stage_changed_at,
  p.priority,
  p.assigned_to,
  p.owner_name,
  p.next_action,
  p.next_action_at,
  p.asking_price,
  p.offer_price,
  p.arv,
  p.repair_estimate,
  p.tags,
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
