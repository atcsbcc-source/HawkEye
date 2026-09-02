"""HawkEye intelligence layer: multi-factor vacancy scoring.

`features` turns a change-detector result plus scan history and flight-wide
context into a named factor vector; `model` scores it with a calibrated,
explainable logistic model (shipped with an expert prior, retrainable from
operator verdicts via `python -m intel.train`).
"""

from __future__ import annotations

import os
from pathlib import Path

from .features import FactorVector, build_factors, grid_context, history_factors, scene_factors
from .model import DEFAULT_MODEL_PATH, FactorScore, FactorSpec, ScoreResult, VacancyModel

__all__ = [
    "DEFAULT_MODEL_PATH",
    "FactorScore",
    "FactorSpec",
    "FactorVector",
    "ScoreResult",
    "VacancyModel",
    "build_factors",
    "grid_context",
    "history_factors",
    "load_model_for_run",
    "scene_factors",
]


def load_model_for_run() -> VacancyModel:
    """The model the batch runner scores with: HAWKEYE_MODEL_PATH if set,
    else the last trained model beside this package, else the expert prior."""
    override = os.environ.get("HAWKEYE_MODEL_PATH", "").strip()
    path = Path(override) if override else DEFAULT_MODEL_PATH
    if path.exists():
        return VacancyModel.load(path)
    return VacancyModel.prior()
