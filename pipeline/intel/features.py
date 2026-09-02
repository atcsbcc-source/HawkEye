"""Factor extraction: change-detector result + history + flight context -> FactorVector."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

# Confidence at or above which a prior sortie counts toward persistence.
PERSISTENCE_MIN_CONFIDENCE = 60
# Change score (%) at which "stillness" reaches zero.
STILLNESS_FULL_CHANGE = 12.0
HISTORY_WINDOW = 4
Z_CLIP = 4.0


@dataclass
class FactorVector:
    """Named factor values; None means "not observed" and contributes nothing."""

    values: dict[str, float | None] = field(default_factory=dict)

    def get(self, name: str) -> float | None:
        v = self.values.get(name)
        if v is None:
            return None
        f = float(v)
        return f if np.isfinite(f) else None

    def merge(self, other: Mapping[str, float | None]) -> FactorVector:
        return FactorVector({**self.values, **dict(other)})


def stillness_from_change(change_score: float | None) -> float | None:
    if change_score is None:
        return None
    return max(0.0, 1.0 - float(change_score) / STILLNESS_FULL_CHANGE)


def scene_factors(result: Any) -> dict[str, float | None]:
    """Factors available from a single change-detector result (duck-typed so
    tests and the trainer can pass plain objects)."""
    details = getattr(result, "details", None) or {}
    scene = details.get("scene") or {}
    return {
        "lawn_growth": _num(getattr(result, "lawn_growth_index", None)),
        "greenness_level": _num(scene.get("greenness_level")),
        "texture_level": _num(scene.get("texture_level")),
        "vehicle_static": 1.0 if getattr(result, "vehicle_static", False) else 0.0,
        "vehicle_absent": 0.0 if getattr(result, "vehicle_present", False) else 1.0,
        "stillness": stillness_from_change(_num(getattr(result, "change_score", None))),
        "clutter": _num(scene.get("clutter_index")),
        "alignment_quality": _num(getattr(result, "alignment_quality", None)),
    }


def history_factors(
    history: Sequence[Mapping[str, Any]], current_lgi: float | None
) -> dict[str, float | None]:
    """`history` = this parcel's PRIOR scans, newest first (the current sortie
    excluded), each with vacancy_confidence and lawn_growth_index."""
    persistence = 0
    for h in history:
        conf = _num(h.get("vacancy_confidence"))
        if conf is not None and conf >= PERSISTENCE_MIN_CONFIDENCE:
            persistence += 1
        else:
            break

    series = [_num(h.get("lawn_growth_index")) for h in history[:HISTORY_WINDOW]]
    series = [v for v in reversed(series) if v is not None]  # oldest -> newest
    if current_lgi is not None:
        series.append(float(current_lgi))
    trend: float | None = None
    if len(series) >= 2:
        x = np.arange(len(series), dtype=np.float64)
        y = np.asarray(series, dtype=np.float64)
        trend = float(np.polyfit(x, y, 1)[0])
    return {"persistence_weeks": float(persistence), "lgi_trend": trend}


def robust_z(x: float | None, population: Sequence[float | None]) -> float | None:
    """(x - median) / (1.4826 * MAD), clipped; None unless >= 3 peers exist."""
    if x is None:
        return None
    pop = np.asarray([v for v in population if v is not None], dtype=np.float64)
    if pop.size < 3:
        return None
    med = float(np.median(pop))
    mad = float(np.median(np.abs(pop - med))) * 1.4826
    if mad < 1e-9:
        mad = float(pop.std()) or 1e-9
    return float(np.clip((float(x) - med) / mad, -Z_CLIP, Z_CLIP))


@dataclass
class GridContext:
    """Flight-wide populations of the absolute scene descriptors."""

    greenness: list[float | None] = field(default_factory=list)
    texture: list[float | None] = field(default_factory=list)


def grid_context(results: Sequence[Any]) -> GridContext:
    ctx = GridContext()
    for r in results:
        scene = (getattr(r, "details", None) or {}).get("scene") or {}
        ctx.greenness.append(_num(scene.get("greenness_level")))
        ctx.texture.append(_num(scene.get("texture_level")))
    return ctx


def build_factors(
    result: Any,
    history: Sequence[Mapping[str, Any]] = (),
    grid: GridContext | None = None,
) -> FactorVector:
    base = scene_factors(result)
    fv = FactorVector(base)
    fv = fv.merge(history_factors(history, base.get("lawn_growth")))
    if grid is not None:
        fv = fv.merge(
            {
                "greenness_vs_grid": robust_z(base.get("greenness_level"), grid.greenness),
                "texture_vs_grid": robust_z(base.get("texture_level"), grid.texture),
            }
        )
    return fv


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None if v is None else float(v)
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None
