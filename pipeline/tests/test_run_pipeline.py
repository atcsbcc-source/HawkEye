"""Batch runner (offline dry-run path) and pre-flight checks."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

import preflight
from run_pipeline import process_flight
from tests.conftest import make_textured_scene, shift_image


def stage_flight(root: Path, code: str, parcels: dict[str, bool], rng: np.random.Generator) -> Path:
    """Write current/previous crops; parcels mapping value = has previous week."""
    for parcel_id, paired in parcels.items():
        d = root / code / parcel_id
        d.mkdir(parents=True)
        scene = make_textured_scene(rng)
        cv2.imwrite(str(d / "current.jpg"), shift_image(scene, 2.0, -1.0))
        if paired:
            cv2.imwrite(str(d / "previous.jpg"), scene)
    return root


def test_dry_run_scores_every_pair_without_a_client(tmp_path, rng, caplog):
    data = stage_flight(tmp_path, "FLT-TEST", {"P-1": True, "P-2": True, "P-3": False}, rng)
    caplog.set_level("INFO", logger="hawkeye")
    summary = process_flight(None, "FLT-TEST", data, 2.5, dry_run=True)
    assert summary.processed == 2
    assert summary.skipped_missing_pair == 1
    assert summary.failed == 0
    assert summary.model_version.startswith(("prior", "trained"))
    assert "DRY RUN" in caplog.text
    assert "P-1" in caplog.text and "confidence=" in caplog.text


def test_process_flight_requires_client_unless_dry_run(tmp_path):
    with pytest.raises(ValueError):
        process_flight(None, "FLT-X", tmp_path, 2.5)


def test_preflight_env_checks():
    bad = preflight.check_env({})
    assert any(c.status == "FAIL" and "SUPABASE_URL" in c.name for c in bad)
    good = preflight.check_env(
        {
            "SUPABASE_URL": "https://abc.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "x" * 40,
            "DASHBOARD_URL": "https://hawkeye.example.com",
            "HAWKEYE_PIPELINE_TOKEN": "t" * 40,
        }
    )
    assert all(c.status == "PASS" for c in good)
    assert not any("supabase.co" in c.detail and "x" * 10 in c.detail for c in good)  # no secrets
    http = preflight.check_env(
        {"SUPABASE_URL": "http://abc", "SUPABASE_SERVICE_ROLE_KEY": "x" * 40}
    )
    assert any(c.status == "FAIL" and "https" in c.detail for c in http)


def test_preflight_offline_run_and_flight_staging(tmp_path, rng):
    data = stage_flight(tmp_path, "FLT-TEST", {"P-1": True}, rng)
    checks = preflight.run("FLT-TEST", data, offline=True)
    names = {c.name: c for c in checks}
    assert names["model"].status == "PASS"
    assert (
        names["crops staged"].status == "PASS"
        and "1 with a previous week" in names["crops staged"].detail
    )
    assert all(c.status != "FAIL" for c in checks if c.name.startswith("python"))
    missing = preflight.run("FLT-NOPE", data, offline=True)
    assert {c.name: c.status for c in missing}["crops staged"] == "FAIL"
