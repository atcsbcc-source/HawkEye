# HawkEye — Drone-Driven Vacancy Reconnaissance

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

Automated real-estate lead platform: weekly DJI Mavic 3 Classic sorties produce
per-parcel overhead crops; a Python/OpenCV pipeline compares each week against
the last to flag distressed or vacant properties; a Next.js command center
surfaces leads crossing a 60-day distress threshold for manual verification and
CRM dispatch.

## Quickstart

```bash
make install && make dev        # http://localhost:3000 in mock mode — no Supabase needed
cp dashboard/.env.example dashboard/.env.local   # then fill it in -> Supabase mode
make check                      # lint + typecheck + tests for both packages
```

Requires Node 22 (`dashboard/.nvmrc`; >= 20 works) and Python 3.11.

```
 Drone sortie ──► stitched ortho ──► pipeline/crop_parcels.py ──► run_pipeline.py
                                    │  change_detector.py (ORB align → shadow-masked
                                    │  diff → lawn/vehicle signals → confidence)
                                    ▼
                        Supabase (Postgres + Storage)
                          properties · flights · property_scans
                          auto-flag trigger @ confidence ≥ 75
                                    ▼
                        dashboard/ (Next.js Command Center)
                          60-day distress filter · Week 1 vs Week N
                          swipe comparison · CRM webhook dispatch
```

## Repository layout

| Path | What it is |
|---|---|
| `supabase/migrations/` | SQL schema: tables, distress view, RLS, storage bucket, triggers, seed rules |
| `pipeline/crop_parcels.py` | Ortho-crop step: GeoTIFF orthomosaic → per-parcel Week T / T-1 crop pairs |
| `pipeline/change_detector.py` | Core CV: alignment, illumination/shadow suppression, change + lawn + vehicle scoring |
| `pipeline/run_pipeline.py` | Batch runner: analyze a flight's crops, upload imagery, upsert `property_scans` |
| `pipeline/settings.py` | Env loading with readable failures (`require_env`, `require_https`) |
| `pipeline/tests/` | pytest suite on synthetic imagery |
| `dashboard/` | Next.js 14 (App Router) + TypeScript + Tailwind + Lucide command center |
| `dashboard/app/operations` | Ops console: live tactical map, telemetry, mission tasking |
| `dashboard/app/automation` | Automation rules (trigger → condition → action) + audit stream |
| `dashboard/lib/server/` | Ops layer: missions, audit, rules, DB helpers (barrel: `ops.ts`) |
| `dashboard/lib/automation/` | Pure rule evaluator and dependency-injected actions |
| `dashboard/lib/drone/` | Drone adapter interface: flight simulator + DJI Cloud API stub |
| `dashboard/lib/constants.ts` | Product thresholds (auto-flag 75, distress 60 days, ...) |
| `dashboard/__tests__/` | vitest suites |
| `CLAUDE.md` | Working rules for AI assistants (live-Supabase rule, conventions) |

## Data modes

| Mode | When | Behaviour |
|---|---|---|
| **Mock / dev** | `NEXT_PUBLIC_SUPABASE_URL` unset (fresh clone, CI) | No auth. Mock leads and scans, two in-memory default rules, in-memory audit stream. The ops console (simulator, missions, SSE telemetry) is fully functional. |
| **Supabase** | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` set; `SUPABASE_SERVICE_ROLE_KEY` for server writes | Leads come from the `distressed_properties` view; rules and audit events are read from and written to Postgres exclusively (an empty `automation_rules` table shows no rules — apply the seed migration). Requires the login flow (see *Authentication*). |

In both modes the **mission queue and drone adapter are in-process only**: they
front live hardware, not durable business data, and reset when the server
restarts. Dispatching to a CRM needs `CRM_WEBHOOK_URL` (dashboard) and the
service role key.

## 1. Database (Supabase)

```bash
supabase link --project-ref <your-ref>
supabase db push          # applies supabase/migrations/ in order
```

Key behaviors baked into the schema:

- `property_scans.vacancy_confidence ≥ 75` auto-flags the property and stamps
  `first_flagged_at` (never demotes a `dispatched` lead). The trigger is the
  flagging authority; `dashboard/lib/constants.ts` mirrors the value for the UI
  and rule defaults — change both via a new migration.
- `distressed_properties` view computes `days_distressed`; the dashboard
  filters it at **60 days**.
- RLS: authenticated users read; only the service-role pipeline writes.
- Private `property-scans` storage bucket, laid out as
  `<parcel_id>/<flight_code>/{current,previous,diff}.jpg`; the dashboard reads
  via signed URLs.
- `20260903030000_seed_default_rules.sql` seeds the two default automation
  rules with fixed ids; the flag rule ships disabled because the trigger
  already flags.

Never edit an applied migration — add a new timestamped file.

## 2. CV pipeline

```bash
pip install -e './pipeline[dev]'     # or: cd pipeline && pip install -r requirements.txt
```

**Step 1 — crop parcels from the stitched ortho** (WebODM / DroneDeploy /
Pix4D GeoTIFF, any CRS, north-up):

```bash
cd pipeline
python crop_parcels.py --ortho FLT-2026-W35.tif \
    --flight-code FLT-2026-W35-OAKWOOD \
    --prev-flight-code FLT-2026-W34-OAKWOOD \
    --parcels parcels.csv --out data/       # csv: parcel_id,lat,lng; omit to pull from Supabase
```

Writes `data/<flight_code>/<parcel_id>/current.jpg` (and copies last week's
crop in as `previous.jpg`), skipping parcels outside the ortho's coverage
(including coordinates outside the ortho's projection domain). Parcel rows with
out-of-range lat/lng abort with the offending CSV line. It logs the measured
GSD to pass to the next step.

**Step 2 — score a single pair** (or let `run_pipeline.py` batch it):

```bash
python change_detector.py --prev week_t-1.jpg --curr week_t.jpg \
    --gsd-cm 2.5 --debug-dir debug_out/
```

Emits JSON with `alignment_quality`, `change_score`, `lawn_growth_index`,
`vehicle_present`, `vehicle_static`, `vacancy_confidence` — matching the
`property_scans` columns. `--debug-dir` writes the aligned frame, shadow mask,
change mask, and an annotated overlay for tuning.

Batch a whole flight (uploads to Storage and upserts scans):

```bash
cp .env.example .env      # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional DASHBOARD_URL + HAWKEYE_PIPELINE_TOKEN
python run_pipeline.py --flight-code FLT-2026-W35-OAKWOOD --data-dir data/ [--verbose]
```

The runner looks every parcel up in one query, skips unknown parcels and
missing pairs, keeps going past a failed parcel, and prints a summary
(`processed / skipped_missing_pair / skipped_unknown_parcel / failed`). Exit
codes: `0` ok, `1` if any parcel failed, `2` if the flight code is unknown.
When `DASHBOARD_URL` (https only) and `HAWKEYE_PIPELINE_TOKEN` are set it
POSTs each scan to `/api/automation/evaluate` with a bearer token; redirects
are never followed.

The vehicle detector segments car-footprint blobs whose color deviates from the
surrounding pavement (robust to pavement-joint/curb clutter; blind spot: a gray
car on gray pavement). Nodata borders from ortho coverage edges are masked out
of every statistic. Swap in a YOLO model behind `detect_vehicle_boxes()` when
you outgrow the heuristic — callers won't change.

## 3. Command center

```bash
cd dashboard
npm install
cp .env.example .env.local   # optional: without it the UI runs on mock data
npm run dev
```

- **Command Center** — stat cards + filterable property grid (search, status,
  one-click "60+ days distressed" filter), sorted by vacancy confidence.
- **Property detail** — Week 1 baseline vs any flight week with a swipe
  comparator, per-scan metrics, and a **Dispatch lead to CRM** action that
  POSTs to `CRM_WEBHOOK_URL` via `/api/dispatch` and marks the lead
  `dispatched`.
- **Operations** (`/operations`) — dark tactical map (Leaflet/CARTO) of the
  AO with parcel status markers, live 1 Hz aircraft telemetry over SSE
  (battery/alt/speed/heading/sats/link), and a mission tasking queue:
  create a grid mission over the AO, launch, watch progress, abort/RTB.
- **Automation** (`/automation`) — declarative trigger→condition→action
  rules (scan confidence ≥ N → flag property; distress ≥ N days → CRM
  webhook; mission completed → notify) with enable toggles, fire counts,
  and an append-only audit event stream fed by missions, rules, the
  pipeline, and Postgres triggers. Webhook deliveries are audited as
  `webhook.delivered` / `webhook.failed` with status and latency.

### Authentication

<!-- INTEGRATOR: fill from the security package summary (login/invite flow,
     roles, Supabase dashboard settings, HAWKEYE_PIPELINE_TOKEN, CRON_SECRET). -->

_Placeholder — to be completed._

### Features added 2026-09

<!-- INTEGRATOR: fill from the features package summary (properties import
     format, verification semantics, sweep cron, flights, KMZ import steps for
     DJI Fly / Pilot 2). -->

_Placeholder — to be completed._

### Console UI notes

<!-- INTEGRATOR: fill from the ui package summary (design tokens, colour rules,
     header/SessionChip placement). -->

_Placeholder — to be completed._

## Testing

```bash
make check                                 # everything below
cd dashboard && npm run lint && npm run typecheck && npm test && npm run build
python -m pytest -q pipeline/tests
ruff check pipeline && ruff format --check pipeline
mypy --config-file pipeline/pyproject.toml pipeline
```

- Dashboard unit tests: vitest, `dashboard/__tests__/**/*.test.ts` mirroring
  `lib/` (rule evaluation, action execution with fake deps, simulator route
  generation and a deterministic flight, audit store). No network.
- Pipeline tests: pytest, `pipeline/tests/` on synthetic scenes and a
  synthetic EPSG:32617 GeoTIFF — alignment recovery, masks, change/lawn/vehicle
  signals, the confidence table, cropping and CSV validation.
- CI (`.github/workflows/ci.yml`) runs both jobs on every push to `main` and
  every pull request; the dashboard job builds in mock mode with no secrets.

## Drone integration (SDK / enterprise aircraft)

The ops console talks to aircraft through one interface,
`dashboard/lib/drone/adapter.ts`:

- **SimulatorAdapter** (default) — in-process flight model (serpentine grid
  coverage, battery drain, RTB) so the console is fully operable with zero
  hardware. Routes are bounded (`SIM_CONSTANTS.MAX_ROWS`) and a faulted tick
  returns the aircraft to base instead of wedging the ticker.
- **DjiCloudAdapter** (`lib/drone/djiCloud.ts`) — the integration point for
  DJI Cloud API aircraft (Mavic 3E/3T, Matrice 30/300/350, Dock): point DJI
  Pilot 2 at your MQTT broker, feed `thing/product/{sn}/osd` telemetry into
  `ingestOsd()`, and implement wayline KMZ upload + `flighttask_execute`
  for `launchMission()`. The class docs sketch the exact topic map. Swap the
  adapter in `createAdapter()` (`lib/server/state.ts`).

Consumer drones without SDK access (Mavic 3 Classic, Mini 5 Pro) keep using
the manual KMZ→DJI Fly workflow; their imagery enters through
`crop_parcels.py` identically either way.

## Operational notes

- Fly the same grid/altitude each week; alignment quality gates every score,
  and consistent GSD keeps the vehicle-footprint heuristic honest.
- Tune the constants at the top of `change_detector.py` (and the 75-point
  auto-flag threshold in `lib/constants.ts` + the migration trigger) against
  ground-truthed leads.
- Comply with FAA Part 107 and local privacy/ordinance rules for imagery
  capture and retention.
