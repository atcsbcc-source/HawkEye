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

Every page and API route sits behind **Supabase Auth** (cookie sessions via
`@supabase/ssr`, refreshed by `dashboard/middleware.ts`). With
`NEXT_PUBLIC_SUPABASE_URL` unset the console runs in **DEV MODE**: no login, an
amber `DEV MODE · no auth · mock data` badge in the header, and mock data.

- **Sign-ups are invite-only.** Invite an operator from a machine that has the
  service-role key:
  `SITE_URL=<deployed origin> npx tsx dashboard/scripts/invite-user.ts <email> [operator|admin]`.
  The invite e-mail lands on `/auth/confirm`, which verifies the token hash and
  sends the user to `/auth/set-password`.
- **Roles** live in `app_metadata.role`: `admin` can launch/abort missions,
  call the manual rule evaluator, run the distress sweep from the console and
  delete flights (which cascades to their scans); `operator` can do everything
  else. Every route handler re-checks the session itself (`withAuth`), so the
  middleware is never the only guard. Unauthenticated `/api/*` calls get `401`
  JSON; pages redirect to `/login?next=`.
- **CSRF**: cookie-authenticated mutations must come from the same origin
  (`Sec-Fetch-Site` / `Origin` are checked; set `TRUST_PROXY=1` behind
  Vercel/nginx so the forwarded host is trusted) and carry
  `Content-Type: application/json` — the two exceptions are a body-less
  `DELETE` and the `multipart/form-data` / `text/csv` / `application/geo+json`
  bodies of `POST /api/properties/import`. A cross-site form can produce none
  of these combinations.
- **Machine tokens** bypass the cookie gate on two routes only:
  `HAWKEYE_PIPELINE_TOKEN` (>= 32 chars, `openssl rand -hex 32`) for the
  pipeline's `POST /api/automation/evaluate`, and `CRON_SECRET` for
  `GET|POST /api/automation/sweep` (Vercel Cron sends it automatically). Both are
  compared in constant time.
- **Outbound webhooks** (`CRM_WEBHOOK_URL`, rule `dispatch_webhook` actions) go
  through `lib/server/safe-fetch.ts`: https only, public hosts only (SSRF
  ranges blocked, optional `WEBHOOK_ALLOWED_HOSTS`), no redirects, 8 s timeout,
  and — when `WEBHOOK_SIGNING_SECRET` is set — signed with
  `x-hawkeye-timestamp` + `x-hawkeye-signature = hex(HMAC-SHA256(secret, "${ts}.${body}"))`.
- **Production boot check**: `next start` refuses to run without Supabase unless
  `HAWKEYE_ALLOW_DEV_MODE=1` (`npm run dev` and `npm run build` are unaffected).
  Security headers (CSP, HSTS in prod, `X-Frame-Options: DENY`, COOP, ...) ship
  from `next.config.mjs`.

Supabase dashboard settings to flip: Email provider ON with *Allow new users to
sign up* OFF; leaked-password protection ON; Site URL = deployed origin and
Redirect URL `<origin>/auth/confirm`; Invite / Reset e-mail templates linking to
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}`.
`dashboard/.env.example` lists every key.

### Features added 2026-09

- **Properties** — `Add property` (`/properties/new`), edit
  (`/properties/[id]/edit`), and `Import parcels` (CSV with header
  `parcel_id,address,lat,lng[,neighborhood,notes]` in any order/case, or a
  GeoJSON `FeatureCollection` of Point / Polygon / MultiPolygon features —
  polygons use their centroid). The import dry-run previews new / updated /
  invalid rows with row numbers, then upserts on `parcel_id` (5 MB max).
  `DELETE` is a soft archive (`archived_at`).
- **Verification** — on the detail page an operator records
  `verified_vacant` / `false_positive` / `occupied` / `needs_recheck`. Verdicts
  land in `property_verifications` and are audited as `property.verified`;
  `false_positive` and `occupied` return the parcel to `active`, clear
  `first_flagged_at` and set `snoozed_until = now + 8 weeks`, during which the
  `auto_flag_property()` trigger will not re-flag it. Dispatch is disabled while
  the verdict is anything but `verified_vacant`.
- **Distress sweep** — `POST|GET /api/automation/sweep` evaluates enabled
  `distress_threshold` rules against flagged parcels past `min_days` (skipping
  parcels whose verdict is anything but `verified_vacant`), once per
  (rule, parcel) via `automation_rule_firings`. Only a rule whose action
  actually succeeded is ledgered, and a parcel is marked `dispatched` only
  when its `dispatch_webhook` delivery returned 2xx — a CRM outage, timeout or
  missing webhook URL leaves the lead flagged (`webhook.failed` in the audit
  stream, `failed` in the sweep summary) so the next sweep retries it.
  Accepted callers: `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it
  automatically; `dashboard/vercel.json` schedules it daily at 13:00 UTC) or an
  `admin` session — the `Run sweep now` button on `/automation` uses the
  latter, whether or not `CRON_SECRET` is set. Plain cron alternative:
  `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/automation/sweep`.
- **Flights** — create the flight row on `/flights` before running the pipeline;
  `/flights/[id]` lists what it processed and prints the exact
  `crop_parcels.py` / `run_pipeline.py` commands.
- **Mission export (KMZ/KML)** — on `/operations` click the download icon on a
  mission: **KMZ** is DJI WPML (`wpmz/template.kml` + `wpmz/waylines.wpml`,
  90 m AGL, 75 / 65 % overlap, Mavic 3 Classic camera model, optional
  `?altitude=&front=&side=`), **KML** opens in Google Earth. Import in **DJI
  Pilot 2** (RC Pro): copy the `.kmz` to the RC's
  `DJI/com.dji.industry.pilot/waypoint/` folder or use *Flight Route → Import*.
  The consumer **DJI Fly** app does not import WPML directly — open the KML in
  Google Earth / a third-party waypoint app and fly the same serpentine.
- **Lead export** — `Export CSV` on the command center, or
  `/api/leads/export?format=csv|geojson&status=&neighborhood=&minDays=`.

New migration `20260903020000_properties_verifications_firings.sql` adds the
verification / snooze / archive columns, `property_verifications`,
`automation_rule_firings` and recreates `distressed_properties`.

### Console UI notes

- **Colour rule** — amber = primary action + flagged/attention; cyan = aircraft
  and mission activity; emerald = done/idle/dispatched; red = threshold, abort,
  stale; sky = selection/focus only.
- **Tokens** live in `dashboard/tailwind.config.ts` (`surface.*`, `status.*`,
  `drone.*`, `text-label` = 11 px floor) and `dashboard/lib/ui/status.ts`
  (`LEAD_STATUS` / `MISSION_STATUS` / `DRONE_STATE` → `StatusBadge`).
  Component classes in `app/globals.css`: `.panel`, `.panel-title`, `.kicker`,
  `.btn-primary` (h-9, amber), `.btn-secondary` / `.btn-ghost` (h-8),
  `.btn-danger`, `.input`. Spacing rhythm 4/8/16/24 (`p-4` panels, `gap-4`
  between panels, `space-y-6` between sections).
- **Shell** — `components/shell/{Sidebar,Header,MobileNav}`; the header's
  `actions` slot hosts the auth `SessionChip` (user e-mail + sign-out, or the
  DEV MODE badge). Route titles use the layout's `%s · HawkEye` template.
- **Dates** render in `NEXT_PUBLIC_OPS_TZ` (default `America/New_York`) via
  `lib/format.ts`; relative times render only after mount (`lib/ui/useNow.ts`).
- **Telemetry rail** shows LIVE / CONNECTING / RECONNECTING / STALE (> 3 s
  without a frame); the map draws a dashed "last known position" marker when
  stale.
- **Detail page** — Swipe / Side-by-side / Diff comparator (Diff only when the
  scan has `image_url_diff`); slider supports arrows ±1, Shift ±10, Home/End;
  ALIGN < 0.5 means the diff is unreliable. Dispatch is two-step (click, then
  `Confirm dispatch (3s)`).

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
  generation and a deterministic flight, audit store), plus `__tests__/security`
  (SSRF table, rate limiter, schemas), `__tests__/ui` (formatting, status maps,
  nav) and `__tests__/features` (grid planner, WPML, import parsers, lead
  export). No network.
- Production smoke test in mock mode: `npm run build && HAWKEYE_ALLOW_DEV_MODE=1 npm start`
  (a production server refuses to boot without Supabase otherwise).
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
