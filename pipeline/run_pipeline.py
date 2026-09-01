#!/usr/bin/env python3
"""
HawkEye batch runner.

Walks a directory of per-parcel crops from the latest flight, pairs each with
the previous week's crop, runs change_detector.analyze_pair(), uploads the
imagery to the `property-scans` storage bucket, and upserts a row into
`property_scans`. The auto-flag trigger in Postgres promotes properties whose
vacancy_confidence crosses the threshold.

Expected input layout (produced by your ortho-crop step after each flight):

  data/
    FLT-2026-W35-OAKWOOD/          <- --flight-code, must exist in `flights`
      1234-567-890/                <- parcel_id, must exist in `properties`
        current.jpg                <- this week's crop
        previous.jpg               <- last week's crop (skip parcel if absent)

Usage:
  python run_pipeline.py --flight-code FLT-2026-W35-OAKWOOD --data-dir data/
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import asdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

from change_detector import analyze_pair

BUCKET = "property-scans"


def get_client() -> Client:
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def upload_crop(db: Client, local: Path, remote: str) -> str:
    with open(local, "rb") as f:
        db.storage.from_(BUCKET).upload(
            remote, f.read(),
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
    return remote  # store the bucket path; dashboard fetches signed URLs


def process_flight(db: Client, flight_code: str, data_dir: Path, gsd_cm: float) -> None:
    flight = (db.table("flights").select("id, gsd_cm_per_px")
                .eq("flight_code", flight_code).single().execute()).data
    gsd = float(flight.get("gsd_cm_per_px") or gsd_cm)

    flight_dir = data_dir / flight_code
    parcels = sorted(p for p in flight_dir.iterdir() if p.is_dir())
    print(f"[{flight_code}] {len(parcels)} parcels, gsd={gsd} cm/px")

    for parcel_dir in parcels:
        parcel_id = parcel_dir.name
        curr, prev = parcel_dir / "current.jpg", parcel_dir / "previous.jpg"
        if not curr.exists() or not prev.exists():
            print(f"  - {parcel_id}: missing pair, skipped")
            continue

        prop = (db.table("properties").select("id")
                  .eq("parcel_id", parcel_id).single().execute()).data
        result = analyze_pair(prev, curr, gsd_cm=gsd)

        base = f"{parcel_id}/{flight_code}"
        url_curr = upload_crop(db, curr, f"{base}/current.jpg")
        url_prev = upload_crop(db, prev, f"{base}/previous.jpg")

        db.table("property_scans").upsert({
            "property_id": prop["id"],
            "flight_id": flight["id"],
            "image_url_current": url_curr,
            "image_url_previous": url_prev,
            "lawn_growth_index": result.lawn_growth_index,
            "vehicle_present": result.vehicle_present,
            "vehicle_static": result.vehicle_static,
            "change_score": result.change_score,
            "vacancy_confidence": result.vacancy_confidence,
            "alignment_quality": result.alignment_quality,
            "raw_metrics": asdict(result),
        }, on_conflict="property_id,flight_id").execute()

        print(f"  - {parcel_id}: confidence={result.vacancy_confidence} "
              f"lgi={result.lawn_growth_index} change={result.change_score}%")


def main() -> int:
    ap = argparse.ArgumentParser(description="HawkEye flight batch processor")
    ap.add_argument("--flight-code", required=True)
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    ap.add_argument("--gsd-cm", type=float, default=2.5,
                    help="Fallback GSD if the flight row has none")
    args = ap.parse_args()

    process_flight(get_client(), args.flight_code, args.data_dir, args.gsd_cm)
    return 0


if __name__ == "__main__":
    sys.exit(main())
