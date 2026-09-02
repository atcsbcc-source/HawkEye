# First flight runbook — DJI Mavic 3 Classic

Everything HawkEye needs from a sortie is a set of geotagged nadir JPEGs flown
over the same grid every week. The Classic has no SDK, so HawkEye plans the
mission and processes the imagery; DJI Fly flies it.

## T-minus one week (once)

- [ ] Dashboard deployed, Supabase Auth configured, you can sign in as `admin`.
- [ ] Parcels imported (Command Center → **Import parcels**, CSV `parcel_id,address,lat,lng[,neighborhood,notes]` or GeoJSON).
- [ ] `pipeline/.env` filled in; `make preflight` prints **READY**.
- [ ] Mission planned: Operations → **New grid mission** → download **KMZ**
      (defaults: 90 m AGL, 75 % front / 65 % side overlap, Mavic 3 Classic
      camera → ~2.4 cm/px). Adjust with `?altitude=&front=&side=` on the
      download URL if you need a different GSD.
- [ ] Mission loaded into DJI Fly (below) and test-flown once at the site.
- [ ] Airspace checked (LAANC if needed), Part 107 / local rules satisfied.

## Loading the HawkEye KMZ into DJI Fly

DJI Fly's waypoint missions *are* WPML KMZ files (the format HawkEye exports,
`droneEnumValue 68` = Mavic 3 series). DJI Fly has no import button, but the
file can be placed by hand:

1. On site, create any throwaway waypoint mission in DJI Fly and save it — this
   makes DJI Fly create the mission folder on the remote controller.
2. Connect the RC (RC-N1 phone or RC 2 / RC Pro) to a computer in file-transfer
   mode and open DJI Fly's waypoint folder — on the RC 2 it is
   `Android/data/dji.go.v5/files/waypoint/`. Each mission is a folder named by
   a GUID containing `<same GUID>.kmz`.
3. Rename HawkEye's `.kmz` to that GUID and replace the throwaway mission's
   file (keep a copy of the original).
4. Restart DJI Fly; the mission now flies HawkEye's serpentine. Verify the route
   on the map before takeoff, save it, and reuse the *same* saved mission every
   week.

Litchi Utilities documents the folder layout and provides converters if you
prefer to plan in Litchi Mission Hub or Dronelink and export to DJI Fly from
there. Paths can differ by RC model and firmware — the GUID folder under
`waypoint/` is the constant.

## Capture settings

| Setting | Value | Why |
|---|---|---|
| Gimbal | −90° (nadir) | crops are compared pixel-for-pixel |
| Altitude | 90 m AGL (same every week) | GSD ≈ 2.4 cm/px, matches the vehicle-footprint filter |
| Speed | ≤ 8 m/s on the grid | sharpness; the exported mission sets this |
| Overlap | 75 % front / 65 % side | clean orthomosaic |
| Exposure | manual, shutter ≥ 1/1000 s, fixed ISO/WB | rolling-shutter smear and week-to-week colour shifts hurt alignment |
| Format | JPEG (RAW optional) with GPS on | stitchers need the geotags |
| Time of day | same window every week, avoid low sun | shorter, consistent shadows |

## Flight day

1. **Create the flight** in HawkEye: Flights → New flight (code
   `FLT-YYYY-Www-HOOD`, altitude, GSD). The pipeline refuses unknown codes.
2. Fly the saved mission. One ~2 km² grid at 90 m ≈ 20–30 min per battery.
3. Offload the JPEGs and stitch a GeoTIFF orthomosaic (WebODM is free and
   self-hosted; DroneDeploy / Pix4D also work). Save it as
   `pipeline/data/orthos/<flight_code>.tif`.

## After landing

The flight's detail page prints these with the right values filled in:

```bash
cd pipeline
make preflight FLIGHT=FLT-2026-W36-OAKWOOD          # READY?
python crop_parcels.py --ortho data/orthos/FLT-2026-W36-OAKWOOD.tif \
    --flight-code FLT-2026-W36-OAKWOOD \
    --prev-flight-code FLT-2026-W35-OAKWOOD --out data      # omit --prev on the very first flight
python run_pipeline.py --flight-code FLT-2026-W36-OAKWOOD --data-dir data --dry-run   # look before you write
python run_pipeline.py --flight-code FLT-2026-W36-OAKWOOD --data-dir data
```

The very first flight has no previous week, so every parcel is skipped as
"missing pair" — that is expected; it becomes the baseline. Scores start with
the second flight.

Then in the console: review flagged parcels in the verification workspace
(Swipe / Side-by-side / Diff, and the Intelligence panel's drivers), record a
verdict, and dispatch verified-vacant leads past 60 days — by hand or by
enabling the CRM rule. After ~20 verdicts, `python -m intel.train` calibrates
the model to your neighbourhoods.

## If something is off

| Symptom | Likely cause | Fix |
|---|---|---|
| `alignment_quality` < 0.3 on many parcels | different altitude/heading, heavy shadows, blurry frames | re-fly the saved mission at the same altitude; shutter ≥ 1/1000 |
| everything flags at once | grid-wide greening after rain | the model's *vs neighbours* factors absorb this once >3 parcels are in the flight; verify and record false positives |
| parcels "not in `properties`" | parcel ids in the CSV differ from the crop folders | re-import with the same `parcel_id` scheme |
| `flight not found` | flight not created in the console | create it, then re-run |
| Tiles missing on the ops map | offline | the basemaps need internet; scoring does not |
