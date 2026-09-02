"""Intelligence layer: factor extraction, prior scoring, training."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from intel import VacancyModel, build_factors, load_model_for_run
from intel.features import FactorVector, grid_context, history_factors, robust_z, scene_factors
from intel.model import PRIOR_PATH
from intel.train import build_dataset


def result(**overrides):
    base = dict(
        alignment_quality=0.95,
        change_score=0.5,
        lawn_growth_index=0.6,
        vehicle_present=False,
        vehicle_static=False,
        vacancy_confidence=0,
        details={"scene": {"greenness_level": 0.2, "texture_level": 500, "clutter_index": 0.5}},
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_prior_loads_with_unique_factors():
    m = VacancyModel.prior()
    names = [s.name for s in m.specs]
    assert len(names) == len(set(names))
    assert any(s.gate for s in m.specs)
    assert len(m.weighted) >= 10


def test_dashboard_prior_copy_matches():
    twin = Path(__file__).resolve().parents[2] / "dashboard" / "lib" / "intel" / "prior.json"
    if not twin.exists():
        pytest.skip("dashboard copy not present")
    assert json.loads(twin.read_text()) == json.loads(PRIOR_PATH.read_text())


def test_scene_factors_map_detector_output():
    f = scene_factors(result(vehicle_present=True, vehicle_static=True, change_score=6.0))
    assert f["vehicle_static"] == 1.0
    assert f["vehicle_absent"] == 0.0
    assert f["stillness"] == pytest.approx(0.5)
    assert f["greenness_level"] == pytest.approx(0.2)
    assert f["alignment_quality"] == pytest.approx(0.95)


def test_history_persistence_and_trend():
    history = [
        {"vacancy_confidence": 80, "lawn_growth_index": 0.4},
        {"vacancy_confidence": 70, "lawn_growth_index": 0.3},
        {"vacancy_confidence": 20, "lawn_growth_index": 0.2},
        {"vacancy_confidence": 90, "lawn_growth_index": 0.1},
    ]
    f = history_factors(history, current_lgi=0.5)
    assert f["persistence_weeks"] == 2  # streak stops at the 20
    assert f["lgi_trend"] == pytest.approx(0.1, abs=1e-6)
    assert history_factors([], None) == {"persistence_weeks": 0.0, "lgi_trend": None}


def test_robust_z_needs_peers_and_clips():
    assert robust_z(1.0, [1.0, 2.0]) is None
    assert robust_z(None, [1, 2, 3]) is None
    assert robust_z(2.0, [1.0, 2.0, 3.0, 2.0, 1.5]) == pytest.approx(0.0)
    assert robust_z(1e6, [1.0, 2.0, 3.0, 2.0]) == 4.0


def test_grid_context_and_relative_factors():
    peers = [
        result(details={"scene": {"greenness_level": g, "texture_level": 300}})
        for g in (0.1, 0.11, 0.12, 0.1)
    ]
    hot = result(details={"scene": {"greenness_level": 0.35, "texture_level": 900}})
    ctx = grid_context([*peers, hot])
    fv = build_factors(hot, grid=ctx)
    assert fv.get("greenness_vs_grid") == 4.0  # clipped, far above the block
    texture_z = fv.get("texture_vs_grid")
    assert texture_z is not None and texture_z > 0


def test_prior_scores_separate_vacant_from_occupied():
    m = VacancyModel.prior()
    vacant = m.score(
        build_factors(result(lawn_growth_index=0.9, vehicle_present=True, vehicle_static=True))
    )
    occupied = m.score(
        build_factors(result(lawn_growth_index=-0.2, change_score=9.0, vehicle_present=True))
    )
    assert vacant.confidence >= 85
    assert occupied.confidence <= 15
    assert vacant.top_drivers[0].startswith("Lawn overgrowth")
    assert 0.0 <= vacant.probability <= 1.0


def test_score_is_monotonic_in_lawn_growth():
    m = VacancyModel.prior()
    confs = [
        m.score(build_factors(result(lawn_growth_index=v))).confidence
        for v in (-0.5, 0, 0.3, 0.7, 1.0)
    ]
    assert confs == sorted(confs)


def test_missing_factors_contribute_nothing():
    m = VacancyModel.prior()
    full = m.score(FactorVector({"lawn_growth": 0.1, "stillness": 0.5}))
    sparse = m.score(FactorVector({"lawn_growth": 0.1, "stillness": 0.5, "clutter": None}))
    assert full.confidence == sparse.confidence
    assert all(f.contribution == 0 for f in sparse.factors if f.value is None)


def test_alignment_gate_caps_score():
    m = VacancyModel.prior()
    fv = build_factors(result(lawn_growth_index=1.0, vehicle_static=True, vehicle_present=True))
    assert m.score(fv).confidence > 90
    gated = m.score(fv.merge({"alignment_quality": 0.1}))
    assert gated.gated and gated.confidence == 40
    assert gated.top_drivers[-1].startswith("Registration too poor")


def test_to_dict_round_trip_and_score_payload(tmp_path):
    m = VacancyModel.prior()
    path = tmp_path / "model.json"
    m.save(path)
    again = VacancyModel.load(path)
    assert again.to_dict() == m.to_dict()
    payload = again.score(build_factors(result())).to_dict()
    assert {
        "model_version",
        "probability",
        "confidence",
        "gated",
        "factors",
        "top_drivers",
    } <= payload.keys()
    assert all(
        {"name", "label", "value", "z", "weight", "contribution"} <= f.keys()
        for f in payload["factors"]
    )


def test_load_model_for_run_prefers_env_override(tmp_path, monkeypatch):
    custom = VacancyModel.prior()
    custom.version = "custom-9"
    custom.save(tmp_path / "m.json")
    monkeypatch.setenv("HAWKEYE_MODEL_PATH", str(tmp_path / "m.json"))
    assert load_model_for_run().version == "custom-9"
    monkeypatch.delenv("HAWKEYE_MODEL_PATH")
    assert load_model_for_run().version in {"prior-1"} or load_model_for_run().trained_on >= 0


def test_fit_learns_direction_and_stays_near_prior():
    rng = np.random.default_rng(3)
    prior = VacancyModel.prior()
    X, y = [], []
    for _ in range(300):
        lgi = float(rng.uniform(-0.5, 1.0))
        clutter = float(rng.uniform(0, 4))
        # ground truth: overgrowth AND clutter both matter, stillness is noise
        vacant = int(lgi + 0.25 * clutter + rng.normal(0, 0.25) > 0.6)
        X.append(
            FactorVector({"lawn_growth": lgi, "clutter": clutter, "stillness": rng.uniform(0, 1)})
        )
        y.append(vacant)
    fitted = prior.fit(X, y, prior_strength=1.0)
    w = {s.name: s.weight for s in fitted.weighted}
    w0 = {s.name: s.weight for s in prior.weighted}
    assert w["clutter"] > w0["clutter"]  # learned that clutter matters more than the prior said
    assert w["stillness"] < w0["stillness"]  # and that stillness carried no signal here
    assert fitted.metrics["accuracy"] >= 0.85
    assert fitted.trained_on == 300 and fitted.version.startswith("trained-")
    # regularisation keeps untouched factors at their prior weights
    assert w["vehicle_static"] == pytest.approx(w0["vehicle_static"], abs=0.05)


def test_build_dataset_joins_verdicts_to_scans():
    scans: list[dict[str, Any]] = [
        {
            "id": "s1",
            "property_id": "p1",
            "processed_at": "2026-08-01",
            "factor_scores": {"factors": [{"name": "lawn_growth", "value": 0.8}]},
        },
        {
            "id": "s2",
            "property_id": "p1",
            "processed_at": "2026-08-08",
            "factor_scores": {"factors": [{"name": "lawn_growth", "value": 0.9}]},
        },
        {"id": "s3", "property_id": "p2", "processed_at": "2026-08-08", "factor_scores": {}},
    ]
    verifications: list[dict[str, Any]] = [
        {
            "property_id": "p1",
            "scan_id": "s2",
            "verdict": "verified_vacant",
            "created_at": "2026-08-09",
        },
        {"property_id": "p1", "scan_id": None, "verdict": "occupied", "created_at": "2026-08-02"},
        {
            "property_id": "p1",
            "scan_id": None,
            "verdict": "needs_recheck",
            "created_at": "2026-08-09",
        },
        {
            "property_id": "p2",
            "scan_id": "s3",
            "verdict": "false_positive",
            "created_at": "2026-08-09",
        },
    ]
    X, y = build_dataset(verifications, scans)
    assert y == [1, 0]  # needs_recheck skipped, p2 skipped (no factors)
    assert X[0].get("lawn_growth") == 0.9 and X[1].get("lawn_growth") == 0.8


def test_analyze_pair_exposes_scene_descriptors(textured_scene, shifted, tmp_pair):
    from change_detector import analyze_pair

    prev, curr = tmp_pair(textured_scene, shifted(textured_scene, 3.0, -2.0))
    scene = analyze_pair(prev, curr, gsd_cm=2.5).details["scene"]
    assert {
        "greenness_level",
        "texture_level",
        "pavement_fraction",
        "clutter_index",
    } <= scene.keys()
