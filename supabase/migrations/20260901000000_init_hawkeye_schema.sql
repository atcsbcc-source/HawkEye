-- ============================================================================
-- HawkEye — Automated Real-Estate Vacancy Reconnaissance
-- Initial schema: properties, flights, property_scans, distress view,
-- storage bucket for imagery, RLS policies, and auto-flagging triggers.
--
-- Apply with:  supabase db push   (or paste into the Supabase SQL editor)
-- ============================================================================

-- PostGIS for neighborhood polygons and property point geometry.
create extension if not exists postgis;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type public.lead_status as enum ('active', 'flagged', 'dispatched');

-- ----------------------------------------------------------------------------
-- properties — one row per parcel under surveillance
-- ----------------------------------------------------------------------------
create table public.properties (
  id               uuid primary key default gen_random_uuid(),
  parcel_id        text not null unique,
  address          text not null,
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  -- Generated point geometry so we can do spatial joins against flight polygons.
  location         geography(Point, 4326) generated always as
                     (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  status           public.lead_status not null default 'active',
  -- Set automatically the first time a scan crosses the confidence threshold.
  first_flagged_at timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index properties_status_idx   on public.properties (status);
create index properties_location_gix on public.properties using gist (location);

-- ----------------------------------------------------------------------------
-- flights — one row per weekly drone sortie
-- ----------------------------------------------------------------------------
create table public.flights (
  id                 uuid primary key default gen_random_uuid(),
  flight_code        text not null unique,          -- e.g. "FLT-2026-W35-OAKWOOD"
  flown_at           timestamptz not null,
  neighborhood       text not null,
  -- Boundary of the area covered by this sortie (WGS84).
  coverage_polygon   geometry(Polygon, 4326),
  drone_model        text not null default 'DJI Mavic 3 Classic',
  altitude_m         numeric(6,1),
  gsd_cm_per_px      numeric(6,3),                  -- ground sample distance of the ortho crops
  notes              text,
  created_at         timestamptz not null default now()
);

create index flights_flown_at_idx     on public.flights (flown_at desc);
create index flights_coverage_gix     on public.flights using gist (coverage_polygon);

-- ----------------------------------------------------------------------------
-- property_scans — one row per (property, flight) analysis result.
-- Stores the Week T / Week T-1 crop URLs and every score the CV pipeline emits.
-- ----------------------------------------------------------------------------
create table public.property_scans (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references public.properties (id) on delete cascade,
  flight_id           uuid not null references public.flights (id) on delete cascade,

  -- Storage paths/URLs into the `property-scans` bucket.
  image_url_current   text not null,                -- Week T crop
  image_url_previous  text,                         -- Week T-1 crop (null on first scan)
  image_url_diff      text,                         -- optional rendered change mask

  -- Computed signals (see pipeline/change_detector.py)
  lawn_growth_index   numeric(5,3),                 -- -1 .. 1; positive = overgrowth vs last week
  vehicle_present     boolean,
  vehicle_static      boolean,                      -- same vehicle, same spot, across weeks
  change_score        numeric(5,2)                  -- 0-100 persistent-change coverage
                        check (change_score is null or change_score between 0 and 100),
  vacancy_confidence  integer not null default 0
                        check (vacancy_confidence between 0 and 100),
  alignment_quality   numeric(4,3)                  -- 0-1 ORB/RANSAC inlier ratio
                        check (alignment_quality is null or alignment_quality between 0 and 1),
  raw_metrics         jsonb not null default '{}'::jsonb,  -- full pipeline JSON for audit

  processed_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  unique (property_id, flight_id)
);

create index property_scans_property_idx   on public.property_scans (property_id, created_at desc);
create index property_scans_confidence_idx on public.property_scans (vacancy_confidence desc);

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------

-- Keep properties.updated_at fresh.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

-- Auto-flag a property the first time a scan crosses the confidence threshold.
-- Never demotes: a 'dispatched' property stays dispatched.
create or replace function public.auto_flag_property()
returns trigger language plpgsql as $$
declare
  flag_threshold constant integer := 75;
begin
  if new.vacancy_confidence >= flag_threshold then
    update public.properties
       set status           = case when status = 'dispatched' then status else 'flagged' end,
           first_flagged_at = coalesce(first_flagged_at, now())
     where id = new.property_id;
  end if;
  return new;
end $$;

create trigger property_scans_auto_flag
  after insert or update of vacancy_confidence on public.property_scans
  for each row execute function public.auto_flag_property();

-- ----------------------------------------------------------------------------
-- distressed_properties — dashboard view.
-- days_distressed counts from first_flagged_at; the UI filters at >= 60 days.
-- ----------------------------------------------------------------------------
create or replace view public.distressed_properties as
select
  p.id,
  p.parcel_id,
  p.address,
  p.lat,
  p.lng,
  p.status,
  p.first_flagged_at,
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
where p.first_flagged_at is not null;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- Dashboard users (authenticated) read everything; only the pipeline
-- (service_role key, which bypasses RLS) writes.
-- ----------------------------------------------------------------------------
alter table public.properties     enable row level security;
alter table public.flights        enable row level security;
alter table public.property_scans enable row level security;

create policy "authenticated read properties"
  on public.properties for select to authenticated using (true);

create policy "authenticated read flights"
  on public.flights for select to authenticated using (true);

create policy "authenticated read property_scans"
  on public.property_scans for select to authenticated using (true);

-- Dashboard may update lead status only (e.g. mark dispatched after webhook).
create policy "authenticated update property status"
  on public.properties for update to authenticated
  using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Storage bucket for imagery crops (private; serve via signed URLs)
-- Layout:  property-scans/<parcel_id>/<flight_code>/{current,previous,diff}.jpg
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('property-scans', 'property-scans', false)
on conflict (id) do nothing;

create policy "authenticated read scan imagery"
  on storage.objects for select to authenticated
  using (bucket_id = 'property-scans');
