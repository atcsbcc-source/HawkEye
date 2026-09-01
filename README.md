# HawkEye — Drone-Driven Vacancy Reconnaissance

Automated real-estate lead platform: weekly DJI Mavic 3 Classic sorties produce
per-parcel overhead crops; a Python/OpenCV pipeline compares each week against
the last to flag distressed or vacant properties; a Next.js command center
surfaces leads crossing a 60-day distress threshold for manual verification and
CRM dispatch.

```
 Drone sortie ──► ortho crops ──► pipeline/run_pipeline.py
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
| `supabase/migrations/` | SQL schema: tables, distress view, RLS, storage bucket, triggers |
| `pipeline/change_detector.py` | Core CV: alignment, illumination/shadow suppression, change + lawn + vehicle scoring |
| `pipeline/run_pipeline.py` | Batch runner: analyze a flight's crops, upload imagery, upsert `property_scans` |
| `dashboard/` | Next.js 14 (App Router) + TypeScript + Tailwind + Lucide command center |

## 1. Database (Supabase)

```bash
supabase link --project-ref <your-ref>
supabase db push          # applies supabase/migrations/
```

Key behaviors baked into the schema:

- `property_scans.vacancy_confidence ≥ 75` auto-flags the property and stamps
  `first_flagged_at` (never demotes a `dispatched` lead).
- `distressed_properties` view computes `days_distressed`; the dashboard
  filters it at **60 days**.
- RLS: authenticated users read; only the service-role pipeline writes.
- Private `property-scans` storage bucket, laid out as
  `<parcel_id>/<flight_code>/{current,previous,diff}.jpg`; the dashboard reads
  via signed URLs.

## 2. CV pipeline

```bash
cd pipeline
pip install -r requirements.txt
python change_detector.py --prev week_t-1.jpg --curr week_t.jpg \
    --gsd-cm 2.5 --debug-dir debug_out/
```

Emits JSON with `alignment_quality`, `change_score`, `lawn_growth_index`,
`vehicle_present`, `vehicle_static`, `vacancy_confidence` — matching the
`property_scans` columns. `--debug-dir` writes the aligned frame, shadow mask,
change mask, and an annotated overlay for tuning.

Batch a whole flight (uploads to Storage and upserts scans):

```bash
cp .env.example .env      # fill in SUPABASE_URL + service role key
python run_pipeline.py --flight-code FLT-2026-W35-OAKWOOD --data-dir data/
```

The vehicle detector is a calibrated contour heuristic (footprint area, aspect,
rectangularity at your GSD). Swap in a YOLO model behind
`detect_vehicle_boxes()` when you outgrow it — callers won't change.

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

## Operational notes

- Fly the same grid/altitude each week; alignment quality gates every score,
  and consistent GSD keeps the vehicle-footprint heuristic honest.
- Tune the constants at the top of `change_detector.py` (and the 75-point
  auto-flag threshold in the migration) against ground-truthed leads.
- Comply with FAA Part 107 and local privacy/ordinance rules for imagery
  capture and retention.
