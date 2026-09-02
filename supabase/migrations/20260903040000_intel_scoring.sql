-- ============================================================================
-- HawkEye — intelligence scoring
--   * property_scans.factor_scores: the model's per-factor breakdown for the
--     scan (values, z-scores, weights, contributions, top drivers)
--   * property_scans.model_version: which model produced vacancy_confidence
--   * intel_models: registry of trained models (python -m intel.train)
-- Guarded so a re-run is safe.
-- ============================================================================

alter table public.property_scans
  add column if not exists factor_scores jsonb not null default '{}'::jsonb,
  add column if not exists model_version text;

create table if not exists public.intel_models (
  id           uuid primary key default gen_random_uuid(),
  version      text not null unique,
  weights      jsonb not null,                       -- full model document
  sample_count integer not null default 0,
  metrics      jsonb not null default '{}'::jsonb,   -- log_loss, accuracy, positives
  active       boolean not null default true,
  trained_at   timestamptz not null default now()
);

create unique index if not exists intel_models_one_active
  on public.intel_models (active) where active;

alter table public.intel_models enable row level security;

drop policy if exists "authenticated read intel_models" on public.intel_models;
create policy "authenticated read intel_models"
  on public.intel_models for select to authenticated using (true);

revoke insert, update, delete, truncate, references, trigger
  on public.intel_models from authenticated, anon;
grant select on public.intel_models to authenticated;
