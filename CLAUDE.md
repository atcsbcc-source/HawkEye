# HawkEye — working notes for AI assistants

Drone-based real-estate vacancy reconnaissance: weekly DJI orthos -> per-parcel
crops -> OpenCV change detection (`pipeline/`) -> Supabase (`supabase/migrations/`)
-> Next.js 14 App Router command center (`dashboard/`) with an ops console
(Leaflet map, 1 Hz SSE telemetry, mission tasking against a simulator + DJI Cloud
API stub) and an automation rules engine with an audit stream.

## Repo map

| Path | Owner-ish role |
|---|---|
| `supabase/migrations/` | Schema. Applied to the LIVE project — see the rule below. |
| `pipeline/change_detector.py` | Pure numpy/cv2 CV core (alignment, masks, lawn/vehicle signals, confidence). |
| `pipeline/crop_parcels.py` | GeoTIFF -> per-parcel crop pairs (rasterio). |
| `pipeline/run_pipeline.py` | Batch runner: analyze, upload to Storage, upsert `property_scans`, notify the dashboard. |
| `pipeline/intel/` | Vacancy model: `features.py` (factor vector), `model.py` (explainable logistic scorer + fit), `train.py` (refit from verdicts), `prior.json` (expert prior — keep `dashboard/lib/intel/prior.json` identical; a pytest enforces it). |
| `pipeline/settings.py` | `load_env` / `require_env` / `require_https` — the only way env is read. |
| `pipeline/tests/` | pytest suite with synthetic fixtures (no real imagery, no network). |
| `dashboard/app/` | Pages + API routes (`api/missions`, `api/telemetry` SSE, `api/automation`, `api/audit`, `api/dispatch`). |
| `dashboard/lib/server/ops.ts` | Barrel for the ops layer; routes import only from here. |
| `dashboard/lib/server/{state,missions,audit,rules,db}.ts` | Ops implementation (globalThis singleton, mission queue, audit, rule store, `DbError`/`must`). |
| `dashboard/lib/automation/{evaluate,actions}.ts` | Pure rule evaluator + dependency-injected action executor. |
| `dashboard/lib/drone/` | `DroneAdapter` interface, `SimulatorAdapter`, `DjiCloudAdapter` stub. |
| `dashboard/lib/constants.ts` | Product thresholds (see below). |
| `dashboard/lib/ops-types.ts` | camelCase DTOs for the ops layer (frozen contract with the UI). |
| `dashboard/__tests__/` | vitest suites. |

## The live-Supabase rule (most important)

The migrations under `supabase/migrations/` are applied to the live Supabase
project `vsrrmqipgomrgxnkcfof`.

- Never edit an existing migration file. Schema changes are NEW files named
  `YYYYMMDDHHMMSS_description.sql`.
- Never run `apply_migration`, `execute_sql`, or any other mutating Supabase
  MCP tool against that project. Apply new migrations to a Supabase branch or
  a separate dev project, and only with the owner's explicit go-ahead.
- Read-only MCP calls (`list_tables`, `get_advisors`, `generate_typescript_types`)
  are fine.

## Data modes

- **Mock / dev mode** — `NEXT_PUBLIC_SUPABASE_URL` unset. No auth, mock
  leads, in-memory rules (`DEFAULT_RULES` in `lib/server/rules.ts`) and audit
  events. `npm run dev` and `npm run build` with no env vars must always work
  end-to-end; CI builds this way.
- **Supabase mode** — `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (reads) and `SUPABASE_SERVICE_ROLE_KEY` (server writes). Rules and audit
  events are DB-exclusive (an empty table is an empty list — there is no
  fallback to memory). Requires the login flow from the security package.
- `missions` and the drone adapter are in-process only in both modes.

## Scoring

`vacancy_confidence` is produced by `intel.VacancyModel` (prior or trained
`intel/model.json`) inside `run_pipeline.py`, never by hand-weighted code paths
in the dashboard. `change_detector.compute_vacancy_confidence` remains only as
the CLI's standalone fallback. Add a factor by extending `prior.json` (both
copies), `features.py`, and the mock inputs in `dashboard/lib/mock.ts`.

## Thresholds live in exactly two places

`dashboard/lib/constants.ts` (`AUTO_FLAG_CONFIDENCE`, `CONFIDENCE_WARN`,
`DISTRESS_THRESHOLD_DAYS`, `LOW_BATTERY_PCT`, `LOW_LINK_PCT`, audit limits) and
the Postgres trigger `public.auto_flag_property()` (literal `75` in
`20260901000000_init_hawkeye_schema.sql`). The trigger is the flagging
authority; the in-app `flag_property` rule augments it and re-reads the latest
scan from the DB before flagging. Changing the threshold = edit the constant
AND add a new migration that `create or replace`s the trigger function.

## Conventions

- Ops DTOs are camelCase (`lib/ops-types.ts`); database rows are snake_case
  and are mapped in `ruleFromRow` / `eventFromRow`. Do not leak row shapes to
  the UI.
- Every Supabase write goes through `must()` from `lib/server/db.ts` so errors
  throw `DbError` instead of being swallowed.
- `lib/automation/*` must stay free of `lib/supabase.ts` / `lib/server`
  imports (pure, unit-testable); side effects are injected via `ActionDeps`.
- Mock-mode default rule ids are fixed UUIDs
  (`00000000-0000-4000-8000-000000000001/2`) matching the seed migration.
- Env is read once through `settings.py` (pipeline) — never echo env values.

## Tests

- Dashboard: vitest, files under `dashboard/__tests__/**/*.test.ts` mirroring
  `lib/` paths (e.g. `__tests__/lib/automation/evaluate.test.ts`). Import from
  `vitest`, use `@/` imports, never touch the network. `server-only` is
  aliased to an empty stub in `vitest.config.ts`.
- Pipeline: pytest under `pipeline/tests/` with fixtures from `conftest.py`
  (`textured_scene`, `shifted`, `tmp_pair`, `synthetic_geotiff`).

## Commands

```bash
make install          # npm ci + pip install -e './pipeline[dev]'
make dev              # Next dev server (mock mode without dashboard/.env.local)
make check            # lint + typecheck + test for both packages
cd dashboard && npm run lint | typecheck | test | build
python -m pytest -q pipeline/tests && ruff check pipeline && mypy --config-file pipeline/pyproject.toml pipeline
```

Run `make check` before finishing any change. Do not run `prettier --write`
over files you did not touch.
