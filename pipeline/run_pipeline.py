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

Exit codes: 0 ok, 1 when any parcel failed, 2 when the flight is unknown.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from supabase import Client, create_client

from change_detector import analyze_pair
from settings import configure_logging, load_env, require_env, require_https

log = logging.getLogger("hawkeye")

BUCKET = "property-scans"
NOTIFY_TIMEOUT_S = 10


@dataclass
class RunSummary:
    processed: int = 0
    skipped_missing_pair: int = 0
    skipped_unknown_parcel: int = 0
    failed: int = 0

    def __str__(self) -> str:
        return (
            f"processed={self.processed} skipped_missing_pair={self.skipped_missing_pair} "
            f"skipped_unknown_parcel={self.skipped_unknown_parcel} failed={self.failed}"
        )


def get_client() -> Client:
    load_env()
    return create_client(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))


def upload_crop(db: Client, local: Path, remote: str) -> str:
    with open(local, "rb") as f:
        db.storage.from_(BUCKET).upload(
            remote,
            f.read(),
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
    return remote  # store the bucket path; dashboard fetches signed URLs


def process_flight(db: Client, flight_code: str, data_dir: Path, gsd_cm: float) -> RunSummary:
    flight = (
        db.table("flights")
        .select("id, gsd_cm_per_px")
        .eq("flight_code", flight_code)
        .maybe_single()
        .execute()
    )
    if flight is None or not flight.data:
        raise SystemExit(f"flight {flight_code!r} not found in `flights` (exit 2)")
    flight_row = flight.data
    gsd = float(flight_row.get("gsd_cm_per_px") or gsd_cm)

    flight_dir = data_dir / flight_code
    if not flight_dir.is_dir():
        raise SystemExit(f"no crop directory at {flight_dir} (exit 2)")
    parcels = sorted(p for p in flight_dir.iterdir() if p.is_dir())
    log.info("[%s] %d parcels, gsd=%s cm/px", flight_code, len(parcels), gsd)

    # One lookup for every parcel id up front; unknown ids are skipped, not fatal.
    parcel_ids = [p.name for p in parcels]
    known: dict[str, str] = {}
    if parcel_ids:
        rows = (
            db.table("properties").select("id, parcel_id").in_("parcel_id", parcel_ids).execute()
        ).data or []
        known = {r["parcel_id"]: r["id"] for r in rows}

    summary = RunSummary()
    for parcel_dir in parcels:
        parcel_id = parcel_dir.name
        curr, prev = parcel_dir / "current.jpg", parcel_dir / "previous.jpg"
        if not curr.exists() or not prev.exists():
            log.info("  - %s: missing pair, skipped", parcel_id)
            summary.skipped_missing_pair += 1
            continue
        property_id = known.get(parcel_id)
        if property_id is None:
            log.warning("  - %s: not in `properties`, skipped", parcel_id)
            summary.skipped_unknown_parcel += 1
            continue

        try:
            result = analyze_pair(prev, curr, gsd_cm=gsd)

            base = f"{parcel_id}/{flight_code}"
            url_curr = upload_crop(db, curr, f"{base}/current.jpg")
            url_prev = upload_crop(db, prev, f"{base}/previous.jpg")

            db.table("property_scans").upsert(
                {
                    "property_id": property_id,
                    "flight_id": flight_row["id"],
                    "image_url_current": url_curr,
                    "image_url_previous": url_prev,
                    "lawn_growth_index": result.lawn_growth_index,
                    "vehicle_present": result.vehicle_present,
                    "vehicle_static": result.vehicle_static,
                    "change_score": result.change_score,
                    "vacancy_confidence": result.vacancy_confidence,
                    "alignment_quality": result.alignment_quality,
                    "raw_metrics": asdict(result),
                },
                on_conflict="property_id,flight_id",
            ).execute()
        except Exception:
            log.exception("  - %s: FAILED", parcel_id)
            summary.failed += 1
            continue

        summary.processed += 1
        log.info(
            "  - %s: confidence=%s lgi=%s change=%s%%",
            parcel_id,
            result.vacancy_confidence,
            result.lawn_growth_index,
            result.change_score,
        )

        notify_automation(
            {
                "property_id": property_id,
                "parcel_id": parcel_id,
                "vacancy_confidence": result.vacancy_confidence,
                "lawn_growth_index": result.lawn_growth_index,
            }
        )

    log.info("[%s] done: %s", flight_code, summary)
    return summary


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects: the bearer token must not leak to another host."""

    def redirect_request(
        self, req: Any, fp: Any, code: Any, msg: Any, headers: Any, newurl: Any
    ) -> None:
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def notify_automation(payload: dict[str, Any]) -> bool:
    """Fire the dashboard's automation engine for this scan (best-effort).

    Requires DASHBOARD_URL (https only) and HAWKEYE_PIPELINE_TOKEN, sent as a
    bearer token. Returns True when the dashboard acknowledged the event.
    """
    base = os.environ.get("DASHBOARD_URL", "").strip()
    if not base:
        return False
    token = os.environ.get("HAWKEYE_PIPELINE_TOKEN", "").strip()
    if not token:
        log.warning("HAWKEYE_PIPELINE_TOKEN is not set; skipping automation notify")
        return False
    base = require_https("DASHBOARD_URL", base)

    req = urllib.request.Request(
        f"{base}/api/automation/evaluate",
        data=json.dumps({"trigger": "scan_processed", "payload": payload}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with _opener.open(req, timeout=NOTIFY_TIMEOUT_S) as res:
            log.debug("automation notify -> %s", res.status)
            return 200 <= res.status < 300
    except urllib.error.HTTPError as exc:
        log.warning("automation notify failed: HTTP %s", exc.code)
    except OSError as exc:
        log.warning("automation notify failed: %s", exc.__class__.__name__)
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="HawkEye flight batch processor")
    ap.add_argument("--flight-code", required=True)
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    ap.add_argument(
        "--gsd-cm", type=float, default=2.5, help="Fallback GSD if the flight row has none"
    )
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    configure_logging(args.verbose)

    try:
        summary = process_flight(get_client(), args.flight_code, args.data_dir, args.gsd_cm)
    except SystemExit as exc:
        if isinstance(exc.code, str):
            log.error("%s", exc.code)
            return 2
        raise
    return 1 if summary.failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
