-- ============================================================================
-- HawkEye — Operations & Automation layer
-- Mission tasking, automation rules (trigger -> condition -> action), and an
-- append-only audit trail for Palantir-style provenance on every state change.
-- ============================================================================

create type public.mission_status as enum ('queued', 'active', 'completed', 'aborted');

-- ----------------------------------------------------------------------------
-- missions — tasking queue for SDK/Cloud-API connected aircraft
-- ----------------------------------------------------------------------------
create table public.missions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  area_polygon   geometry(Polygon, 4326),
  status         public.mission_status not null default 'queued',
  drone_serial   text,
  progress       numeric(5,2) not null default 0 check (progress between 0 and 100),
  scheduled_for  timestamptz,
  launched_at    timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index missions_status_idx on public.missions (status, created_at desc);

-- ----------------------------------------------------------------------------
-- automation_rules — declarative trigger/condition/action automations
-- Evaluated by the dashboard's /api/automation/evaluate endpoint (called by
-- the CV pipeline after each scan upsert and by mission lifecycle events).
-- ----------------------------------------------------------------------------
create table public.automation_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  trigger_type   text not null check (trigger_type in
                   ('scan_processed', 'distress_threshold', 'mission_completed')),
  -- e.g. {"min_confidence": 75} or {"min_days": 60}
  trigger_config jsonb not null default '{}'::jsonb,
  action_type    text not null check (action_type in
                   ('flag_property', 'dispatch_webhook', 'notify')),
  -- e.g. {"url": "https://hooks.example.com/..."} for dispatch_webhook
  action_config  jsonb not null default '{}'::jsonb,
  enabled        boolean not null default true,
  last_fired_at  timestamptz,
  fire_count     integer not null default 0,
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- audit_events — append-only provenance feed
-- ----------------------------------------------------------------------------
create table public.audit_events (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  actor        text not null default 'system',        -- 'system' | 'pipeline' | 'operator' | rule id
  event_type   text not null,                         -- e.g. 'property.flagged', 'mission.launched'
  subject_type text,                                  -- 'property' | 'mission' | 'rule' | 'scan'
  subject_id   text,
  detail       jsonb not null default '{}'::jsonb
);

create index audit_events_time_idx on public.audit_events (occurred_at desc);
create index audit_events_subject_idx on public.audit_events (subject_type, subject_id);

-- Log every lead-status transition automatically.
create or replace function public.log_property_status_change()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_events (actor, event_type, subject_type, subject_id, detail)
    values ('system', 'property.status_changed', 'property', new.id::text,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'parcel_id', new.parcel_id));
  end if;
  return new;
end $$;

create trigger properties_audit_status
  after update on public.properties
  for each row execute function public.log_property_status_change();

-- Log every scan ingestion.
create or replace function public.log_scan_ingested()
returns trigger language plpgsql as $$
begin
  insert into public.audit_events (actor, event_type, subject_type, subject_id, detail)
  values ('pipeline', 'scan.processed', 'scan', new.id::text,
          jsonb_build_object('property_id', new.property_id,
                             'vacancy_confidence', new.vacancy_confidence));
  return new;
end $$;

create trigger property_scans_audit_insert
  after insert on public.property_scans
  for each row execute function public.log_scan_ingested();

-- ----------------------------------------------------------------------------
-- RLS — authenticated read; writes go through the service-role API routes
-- ----------------------------------------------------------------------------
alter table public.missions         enable row level security;
alter table public.automation_rules enable row level security;
alter table public.audit_events     enable row level security;

create policy "authenticated read missions"
  on public.missions for select to authenticated using (true);
create policy "authenticated read automation_rules"
  on public.automation_rules for select to authenticated using (true);
create policy "authenticated read audit_events"
  on public.audit_events for select to authenticated using (true);
