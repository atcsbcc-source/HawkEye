#!/usr/bin/env python3
"""
HawkEye batch runner.

Walks a directory of per-parcel crops from the latest flight, pairs each with
the previous week's crop, runs change_detector.analyze_pair(), scores every
parcel with the intelligence model (factor vector = scene descriptors + this
parcel's scan history + how it compares with the rest of the flight), uploads
the imagery to the `property-scans` storage bucket, and upserts a row into
`property_scans` with the factor breakdown. The auto-flag trigger in Postgres
promotes properties whose vacancy_confidence crosses the threshold.

Expected input layout (produced by crop_parcels.py after each flight):

  data/
    FLT-2026-W35-OAKWOOD/          <- --flight-code, must exist in `flights`
      1234-567-890/                <- parcel_id, must exist in `properties`
        current.jpg                <- this week's crop
        previous.jpg               <- last week's crop (skip parcel if absent)

Usage:
  python run_pipeline.py --flight-code FLT-2026-W35-OAKWOOD --data-dir data/
  python run_pipeline.py --flight-code FLT-2026-W35-OAKWOOD --data-dir data/ --dry-run
      # offline: analyse + score every pair and print the results, touch nothing

Model: HAWKEYE_MODEL_PATH, else intel/model.json (from `python -m intel.train`),
else the expert prior in intel/prior.json.

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
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from change_detector import ScanResult, analyze_pair
from intel import VacancyModel, build_factors, grid_context, load_model_for_run
from settings import configure_logging, load_env, require_env, require_https

if TYPE_CHECKING:  # the supabase package is only needed at run time (see get_client)
    from supabase import Client

log = logging.getLogger("hawkeye")

BUCKET = "property-scans"
NOTIFY_TIMEOUT_S = 10
HISTORY_LIMIT = 6


@dataclass
class RunSummary:
    processed: int = 0
    skipped_missing_pair: int = 0
    skipped_unknown_parcel: int = 0
    failed: int = 0
    model_version: str = ""

    def __str__(self) -> str:
        return (
            f"processed={self.processed} skipped_missing_pair={self.skipped_missing_pair} "
            f"skipped_unknown_parcel={self.skipped_unknown_parcel} failed={self.failed} "
            f"model={self.model_version}"
        )


@dataclass
class Analyzed:
    parcel_id: str
    property_id: str
    curr: Path
    prev: Path
    result: ScanResult
    history: list[dict[str, Any]] = field(default_factory=list)


def get_client() -> Client:
    # Imported here (as crop_parcels.py does) so `--help` works without the package.
    from supabase import create_client

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


def fetch_history(
    db: Client, property_ids: list[str], flight_id: str
) -> dict[str, list[dict[str, Any]]]:
    """Prior scans per property, newest first, excluding this flight (reprocess-safe)."""
    if not property_ids:
        return {}
    rows = (
        db.table("property_scans")
        .select("property_id, flight_id, vacancy_confidence, lawn_growth_index, processed_at")
        .in_("property_id", property_ids)
        .neq("flight_id", flight_id)
        .order("processed_at", desc=True)
        .execute()
    ).data or []
    history: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        bucket = history.setdefault(r["property_id"], [])
        if len(bucket) < HISTORY_LIMIT:
            bucket.append(r)
    return history


def process_flight(
    db: Client | None,
    flight_code: str,
    data_dir: Path,
    gsd_cm: float,
    model: VacancyModel | None = None,
    *,
    dry_run: bool = False,
) -> RunSummary:
    """Analyse, score and persist one flight. With `dry_run` nothing is read
    from or written to Supabase: every parcel directory is treated as known,
    history is empty, and results are only logged — the way to validate a
    first set of crops before credentials exist."""
    if db is None and not dry_run:
        raise ValueError("a Supabase client is required unless dry_run=True")
    model = model or load_model_for_run()
    if dry_run or db is None:
        flight_row: dict[str, Any] = {"id": "dry-run", "gsd_cm_per_px": None}
    else:
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
    summary = RunSummary(model_version=model.version)
    log.info(
        "[%s] %d parcels, gsd=%s cm/px, model=%s", flight_code, len(parcels), gsd, model.version
    )

    # One lookup for every parcel id up front; unknown ids are skipped, not fatal.
    parcel_ids = [p.name for p in parcels]
    known: dict[str, str] = {}
    if dry_run or db is None:
        known = {pid: pid for pid in parcel_ids}
    elif parcel_ids:
        rows = (
            db.table("properties").select("id, parcel_id").in_("parcel_id", parcel_ids).execute()
        ).data or []
        known = {r["parcel_id"]: r["id"] for r in rows}

    # Pass 1 — analyse every pair so the flight-wide context is complete
    # before anything is scored.
    analyzed: list[Analyzed] = []
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
        except Exception:
            log.exception("  - %s: analysis FAILED", parcel_id)
            summary.failed += 1
            continue
        analyzed.append(Analyzed(parcel_id, property_id, curr, prev, result))

    # Pass 2 — score against history + the rest of the flight, then persist.
    grid = grid_context([a.result for a in analyzed])
    history: dict[str, list[dict[str, Any]]] = {}
    if not dry_run and db is not None:
        history = fetch_history(db, [a.property_id for a in analyzed], flight_row["id"])
    for a in analyzed:
        a.history = history.get(a.property_id, [])
        score = model.score(build_factors(a.result, a.history, grid))
        a.result.vacancy_confidence = score.confidence
        if dry_run or db is None:
            summary.processed += 1
            log.info(
                "  - %-16s confidence=%3d  lgi=%+.2f  change=%4.1f%%  vehicle=%-7s  align=%.2f  %s",
                a.parcel_id,
                score.confidence,
                a.result.lawn_growth_index,
                a.result.change_score,
                "static" if a.result.vehicle_static else str(a.result.vehicle_present).lower(),
                a.result.alignment_quality,
                " · ".join(score.top_drivers) or "no drivers",
            )
            continue
        try:
            base = f"{a.parcel_id}/{flight_code}"
            url_curr = upload_crop(db, a.curr, f"{base}/current.jpg")
            url_prev = upload_crop(db, a.prev, f"{base}/previous.jpg")
            db.table("property_scans").upsert(
                {
                    "property_id": a.property_id,
                    "flight_id": flight_row["id"],
                    "image_url_current": url_curr,
                    "image_url_previous": url_prev,
                    "lawn_growth_index": a.result.lawn_growth_index,
                    "vehicle_present": a.result.vehicle_present,
                    "vehicle_static": a.result.vehicle_static,
                    "change_score": a.result.change_score,
                    "vacancy_confidence": score.confidence,
                    "alignment_quality": a.result.alignment_quality,
                    "raw_metrics": asdict(a.result),
                    "factor_scores": score.to_dict(),
                    "model_version": model.version,
                },
                on_conflict="property_id,flight_id",
            ).execute()
        except Exception:
            log.exception("  - %s: FAILED", a.parcel_id)
            summary.failed += 1
            continue

        summary.processed += 1
        log.info(
            "  - %s: confidence=%s drivers=%s lgi=%s change=%s%%",
            a.parcel_id,
            score.confidence,
            " · ".join(score.top_drivers) or "none",
            a.result.lawn_growth_index,
            a.result.change_score,
        )
        notify_automation(
            {
                "property_id": a.property_id,
                "parcel_id": a.parcel_id,
                "vacancy_confidence": score.confidence,
                "lawn_growth_index": a.result.lawn_growth_index,
                "model_version": model.version,
                "top_drivers": score.top_drivers,
            }
        )

    if dry_run or db is None:
        log.info("[%s] DRY RUN — nothing uploaded or written: %s", flight_code, summary)
    else:
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
        log.warning("automation notify rejected: HTTP %s", exc.code)
    except (urllib.error.URLError, OSError) as exc:
        log.warning("automation notify failed: %s", exc)
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="HawkEye flight batch processor")
    ap.add_argument("--flight-code", required=True)
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    ap.add_argument(
        "--gsd-cm", type=float, default=2.5, help="Fallback GSD if the flight row has none"
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Analyse and score offline; no Supabase reads or writes, no uploads",
    )
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    configure_logging(args.verbose)

    db = None if args.dry_run else get_client()
    summary = process_flight(db, args.flight_code, args.data_dir, args.gsd_cm, dry_run=args.dry_run)
    return 1 if summary.failed else 0


if __name__ == "__main__":
    sys.exit(main())
