"""Refit the vacancy model from operator verdicts.

Labels come from `property_verifications` (verified_vacant -> 1, occupied /
false_positive -> 0, needs_recheck skipped) joined to the factor vector the
pipeline stored on the verified scan (`property_scans.factor_scores`).

Usage:
  python -m intel.train [--out intel/model.json] [--min-samples 20] [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from settings import configure_logging, load_env, require_env

from .features import FactorVector
from .model import DEFAULT_MODEL_PATH, VacancyModel

log = logging.getLogger("hawkeye.intel")
LABELS = {"verified_vacant": 1, "occupied": 0, "false_positive": 0}


def factor_vector_from_scores(scores: Mapping[str, Any] | None) -> FactorVector | None:
    if not scores or not isinstance(scores.get("factors"), list):
        return None
    return FactorVector({f["name"]: f.get("value") for f in scores["factors"] if "name" in f})


def build_dataset(
    verifications: list[dict[str, Any]], scans: list[dict[str, Any]]
) -> tuple[list[FactorVector], list[int]]:
    by_id = {s["id"]: s for s in scans}
    by_property: dict[str, list[dict[str, Any]]] = {}
    for s in sorted(scans, key=lambda s: s.get("processed_at") or "", reverse=True):
        by_property.setdefault(s["property_id"], []).append(s)

    X: list[FactorVector] = []
    y: list[int] = []
    for v in verifications:
        label = LABELS.get(v.get("verdict", ""))
        if label is None:
            continue
        scan = by_id.get(v.get("scan_id"))
        if scan is None:
            cands = [
                s
                for s in by_property.get(v["property_id"], [])
                if (s.get("processed_at") or "") <= (v.get("created_at") or "")
            ]
            scan = cands[0] if cands else None
        fv = factor_vector_from_scores(scan.get("factor_scores") if scan else None)
        if fv is None:
            continue
        X.append(fv)
        y.append(label)
    return X, y


def main() -> int:
    ap = argparse.ArgumentParser(description="Refit the HawkEye vacancy model from verdicts")
    ap.add_argument("--out", type=Path, default=DEFAULT_MODEL_PATH)
    ap.add_argument("--min-samples", type=int, default=20)
    ap.add_argument("--prior-strength", type=float, default=2.0)
    ap.add_argument("--dry-run", action="store_true", help="fit and report, write nothing")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    configure_logging(args.verbose)

    from supabase import create_client

    load_env()
    db = create_client(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
    verifications = (
        db.table("property_verifications")
        .select("property_id, scan_id, verdict, created_at")
        .execute()
        .data
        or []
    )
    scans = (
        db.table("property_scans")
        .select("id, property_id, factor_scores, processed_at")
        .execute()
        .data
        or []
    )
    X, y = build_dataset(verifications, scans)
    log.info("dataset: %d labelled scans (%d vacant)", len(X), sum(y))
    if len(X) < args.min_samples:
        log.error("need at least %d labelled scans; have %d", args.min_samples, len(X))
        return 2

    base = VacancyModel.prior()
    model = base.fit(X, y, prior_strength=args.prior_strength)
    log.info("fitted %s: %s", model.version, model.metrics)
    for old, new in zip(base.weighted, model.weighted, strict=True):
        log.info("  %-20s %+.2f -> %+.2f", new.name, old.weight, new.weight)
    if args.dry_run:
        return 0

    model.save(args.out)
    log.info("wrote %s", args.out)
    db.table("intel_models").update({"active": False}).eq("active", True).execute()
    db.table("intel_models").insert(
        {
            "version": model.version,
            "weights": model.to_dict(),
            "sample_count": model.trained_on,
            "metrics": model.metrics,
            "active": True,
        }
    ).execute()
    log.info("registered %s as the active model", model.version)
    return 0


if __name__ == "__main__":
    sys.exit(main())
