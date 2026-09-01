#!/usr/bin/env python3
"""
HawkEye ortho-crop step.

Turns a georeferenced orthomosaic (GeoTIFF stitched from a Mavic 3 sortie via
WebODM / DroneDeploy / Pix4D) into the per-parcel crop pairs that
run_pipeline.py consumes:

  <out>/<flight_code>/<parcel_id>/current.jpg      crop from this ortho
  <out>/<flight_code>/<parcel_id>/previous.jpg     copied from the prior
                                                   flight's current.jpg

Parcel centroids come from a CSV (parcel_id,lat,lng — export of `properties`)
or straight from Supabase when --parcels is omitted and .env is configured.

Usage:
  python crop_parcels.py --ortho FLT-2026-W35.tif --flight-code FLT-2026-W35-OAKWOOD \
      --prev-flight-code FLT-2026-W34-OAKWOOD --parcels parcels.csv --out data/

Assumes a north-up ortho (the default from all common stitchers).
"""

from __future__ import annotations

import argparse
import csv
import math
import shutil
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform
from rasterio.windows import Window

DEFAULT_RADIUS_M = 22.0   # half-width of the crop window (44 m covers a lot + margin)


def load_parcels_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["lat"], r["lng"] = float(r["lat"]), float(r["lng"])
    return rows


def load_parcels_supabase() -> list[dict]:
    """Fallback: pull every tracked property from Supabase (.env credentials)."""
    import os

    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv()
    db = create_client(os.environ["SUPABASE_URL"],
                       os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    data = db.table("properties").select("parcel_id, lat, lng").execute().data
    return data


def meters_per_pixel(ds: rasterio.DatasetReader, lat: float) -> tuple[float, float]:
    """Ground resolution (m/px) in x and y, handling projected and geographic CRSs."""
    res_x, res_y = ds.res
    if ds.crs and ds.crs.is_geographic:
        return (res_x * 111_320.0 * math.cos(math.radians(lat)),
                res_y * 110_540.0)
    return res_x, res_y


def crop_parcel(ds: rasterio.DatasetReader, lat: float, lng: float,
                radius_m: float) -> np.ndarray | None:
    """Read a (2*radius_m)^2 window centered on the parcel. None if outside."""
    xs, ys = warp_transform("EPSG:4326", ds.crs, [lng], [lat])
    try:
        row, col = ds.index(xs[0], ys[0])
    except (IndexError, ValueError):
        return None
    if not (0 <= row < ds.height and 0 <= col < ds.width):
        return None

    mx, my = meters_per_pixel(ds, lat)
    half_w, half_h = int(radius_m / mx), int(radius_m / my)
    window = Window(col - half_w, row - half_h, 2 * half_w, 2 * half_h)

    data = ds.read(indexes=[1, 2, 3], window=window, boundless=True, fill_value=0)
    return np.transpose(data, (1, 2, 0))  # CHW -> HWC, RGB


def main() -> int:
    ap = argparse.ArgumentParser(description="Crop per-parcel imagery from a flight ortho")
    ap.add_argument("--ortho", required=True, type=Path, help="Georeferenced GeoTIFF")
    ap.add_argument("--flight-code", required=True)
    ap.add_argument("--prev-flight-code", default=None,
                    help="Prior flight whose current.jpg becomes this week's previous.jpg")
    ap.add_argument("--parcels", type=Path, default=None,
                    help="CSV of parcel_id,lat,lng (default: fetch from Supabase)")
    ap.add_argument("--out", type=Path, default=Path("data"))
    ap.add_argument("--radius-m", type=float, default=DEFAULT_RADIUS_M)
    ap.add_argument("--jpeg-quality", type=int, default=92)
    args = ap.parse_args()

    import cv2  # after argparse so --help works without OpenCV

    parcels = (load_parcels_csv(args.parcels) if args.parcels
               else load_parcels_supabase())

    written = skipped = unpaired = 0
    with rasterio.open(args.ortho) as ds:
        mx, my = meters_per_pixel(ds, parcels[0]["lat"]) if parcels else ds.res
        print(f"[{args.flight_code}] ortho {ds.width}x{ds.height} px, "
              f"~{mx * 100:.2f} cm/px — {len(parcels)} parcels")

        for p in parcels:
            crop = crop_parcel(ds, p["lat"], p["lng"], args.radius_m)
            if crop is None or not crop.any():
                skipped += 1
                continue

            parcel_dir = args.out / args.flight_code / p["parcel_id"]
            parcel_dir.mkdir(parents=True, exist_ok=True)
            bgr = cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)
            cv2.imwrite(str(parcel_dir / "current.jpg"), bgr,
                        [cv2.IMWRITE_JPEG_QUALITY, args.jpeg_quality])
            written += 1

            if args.prev_flight_code:
                prev = args.out / args.prev_flight_code / p["parcel_id"] / "current.jpg"
                if prev.exists():
                    shutil.copyfile(prev, parcel_dir / "previous.jpg")
                else:
                    unpaired += 1

    print(f"  wrote {written} crops "
          f"({skipped} outside ortho, {unpaired} without a previous week)")
    print(f"  next: python run_pipeline.py --flight-code {args.flight_code} "
          f"--data-dir {args.out} --gsd-cm {mx * 100:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
