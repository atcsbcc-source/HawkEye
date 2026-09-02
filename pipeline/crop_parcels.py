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
import logging
import math
import shutil
import sys
from pathlib import Path
from typing import Any, TypedDict

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform
from rasterio.windows import Window

from settings import configure_logging, load_env, require_env

log = logging.getLogger("hawkeye")

DEFAULT_RADIUS_M = 22.0  # half-width of the crop window (44 m covers a lot + margin)


class Parcel(TypedDict):
    parcel_id: str
    lat: float
    lng: float


def _validate_parcel(row: dict[str, Any], where: str) -> Parcel:
    parcel_id = str(row.get("parcel_id") or "").strip()
    if not parcel_id:
        raise ValueError(f"{where}: parcel_id is empty")
    try:
        lat, lng = float(row["lat"]), float(row["lng"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"{where} (parcel {parcel_id}): lat/lng must be numbers") from exc
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        raise ValueError(
            f"{where} (parcel {parcel_id}): lat/lng {lat},{lng} out of range "
            "(expected -90..90, -180..180 — swapped columns?)"
        )
    return {"parcel_id": parcel_id, "lat": lat, "lng": lng}


def load_parcels_csv(path: Path) -> list[Parcel]:
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        # Row 1 is the header, so the first data row is line 2.
        return [_validate_parcel(r, f"{path.name} line {i}") for i, r in enumerate(reader, 2)]


def load_parcels_supabase() -> list[Parcel]:
    """Fallback: pull every tracked property from Supabase (.env credentials)."""
    from supabase import create_client

    load_env()
    db = create_client(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
    data = db.table("properties").select("parcel_id, lat, lng").execute().data
    return [_validate_parcel(r, f"properties row {i}") for i, r in enumerate(data, 1)]


def meters_per_pixel(ds: rasterio.DatasetReader, lat: float) -> tuple[float, float]:
    """Ground resolution (m/px) in x and y, handling projected and geographic CRSs."""
    res_x, res_y = ds.res
    if ds.crs and ds.crs.is_geographic:
        return (res_x * 111_320.0 * math.cos(math.radians(lat)), res_y * 110_540.0)
    return res_x, res_y


def crop_parcel(
    ds: rasterio.DatasetReader, lat: float, lng: float, radius_m: float
) -> np.ndarray | None:
    """Read a (2*radius_m)^2 window centered on the parcel. None if outside."""
    try:
        xs, ys = warp_transform("EPSG:4326", ds.crs, [lng], [lat])
    except Exception as exc:  # rasterio raises private CPLE_* types for out-of-domain points
        log.warning("parcel at %.5f,%.5f cannot be projected to %s: %s", lat, lng, ds.crs, exc)
        return None
    x, y = xs[0], ys[0]
    b = ds.bounds
    if not (b.left <= x <= b.right and b.bottom <= y <= b.top):
        return None
    row, col = ds.index(x, y)

    mx, my = meters_per_pixel(ds, lat)
    half_w, half_h = int(radius_m / mx), int(radius_m / my)
    window = Window(col - half_w, row - half_h, 2 * half_w, 2 * half_h)

    data = ds.read(indexes=[1, 2, 3], window=window, boundless=True, fill_value=0)
    return np.transpose(data, (1, 2, 0))  # CHW -> HWC, RGB


def main() -> int:
    ap = argparse.ArgumentParser(description="Crop per-parcel imagery from a flight ortho")
    ap.add_argument("--ortho", required=True, type=Path, help="Georeferenced GeoTIFF")
    ap.add_argument("--flight-code", required=True)
    ap.add_argument(
        "--prev-flight-code",
        default=None,
        help="Prior flight whose current.jpg becomes this week's previous.jpg",
    )
    ap.add_argument(
        "--parcels",
        type=Path,
        default=None,
        help="CSV of parcel_id,lat,lng (default: fetch from Supabase)",
    )
    ap.add_argument("--out", type=Path, default=Path("data"))
    ap.add_argument("--radius-m", type=float, default=DEFAULT_RADIUS_M)
    ap.add_argument("--jpeg-quality", type=int, default=92)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    configure_logging(args.verbose)

    import cv2  # after argparse so --help works without OpenCV

    try:
        parcels = load_parcels_csv(args.parcels) if args.parcels else load_parcels_supabase()
    except ValueError as exc:
        log.error("%s", exc)
        return 2

    written = skipped = unpaired = 0
    with rasterio.open(args.ortho) as ds:
        mx, my = meters_per_pixel(ds, parcels[0]["lat"]) if parcels else ds.res
        log.info(
            "[%s] ortho %dx%d px, ~%.2f cm/px — %d parcels",
            args.flight_code,
            ds.width,
            ds.height,
            mx * 100,
            len(parcels),
        )

        for p in parcels:
            crop = crop_parcel(ds, p["lat"], p["lng"], args.radius_m)
            if crop is None or not crop.any():
                log.debug("  - %s: outside ortho, skipped", p["parcel_id"])
                skipped += 1
                continue

            parcel_dir = args.out / args.flight_code / p["parcel_id"]
            parcel_dir.mkdir(parents=True, exist_ok=True)
            bgr = cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)
            cv2.imwrite(
                str(parcel_dir / "current.jpg"), bgr, [cv2.IMWRITE_JPEG_QUALITY, args.jpeg_quality]
            )
            written += 1

            if args.prev_flight_code:
                prev = args.out / args.prev_flight_code / p["parcel_id"] / "current.jpg"
                if prev.exists():
                    shutil.copyfile(prev, parcel_dir / "previous.jpg")
                else:
                    unpaired += 1

    log.info(
        "  wrote %d crops (%d outside ortho, %d without a previous week)",
        written,
        skipped,
        unpaired,
    )
    log.info(
        "  next: python run_pipeline.py --flight-code %s --data-dir %s --gsd-cm %.2f",
        args.flight_code,
        args.out,
        mx * 100,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
