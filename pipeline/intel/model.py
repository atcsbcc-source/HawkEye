"""Calibrated, explainable vacancy model.

logit = bias + Σ weight_i · z_i,  z_i = clip((value_i − center_i) / scale_i)
p = σ(logit); a gate factor (registration quality) caps p when the crops did
not align. Every factor's contribution is reported so the console can show
why a parcel scored the way it did. Weights start from an expert prior and are
refit from operator verdicts with L2 regularisation back toward that prior, so
a handful of labels nudges the model instead of overturning it.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from .features import FactorVector

PRIOR_PATH = Path(__file__).with_name("prior.json")
DEFAULT_MODEL_PATH = Path(__file__).with_name("model.json")
Z_CLIP = 5.0
TOP_DRIVER_MIN = 0.15


@dataclass(frozen=True)
class FactorSpec:
    name: str
    label: str
    description: str
    center: float
    scale: float
    weight: float
    gate: bool = False
    threshold: float | None = None
    cap: float | None = None


@dataclass
class FactorScore:
    name: str
    label: str
    value: float | None
    z: float
    weight: float
    contribution: float


@dataclass
class ScoreResult:
    probability: float
    confidence: int
    gated: bool
    model_version: str
    factors: list[FactorScore]
    top_drivers: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_version": self.model_version,
            "probability": round(self.probability, 4),
            "confidence": self.confidence,
            "gated": self.gated,
            "top_drivers": self.top_drivers,
            "factors": [
                {**asdict(f), "z": round(f.z, 3), "contribution": round(f.contribution, 3)}
                for f in self.factors
            ],
        }


class VacancyModel:
    def __init__(
        self,
        version: str,
        bias: float,
        specs: list[FactorSpec],
        trained_on: int = 0,
        metrics: dict[str, float] | None = None,
        trained_at: str | None = None,
    ) -> None:
        self.version = version
        self.bias = float(bias)
        self.specs = list(specs)
        self.trained_on = trained_on
        self.metrics = dict(metrics or {})
        self.trained_at = trained_at
        names = [s.name for s in specs]
        if len(names) != len(set(names)):
            raise ValueError("duplicate factor names in model")

    # -- (de)serialisation --------------------------------------------------
    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> VacancyModel:
        specs = [
            FactorSpec(
                name=f["name"],
                label=f["label"],
                description=f.get("description", ""),
                center=float(f.get("center", 0.0)),
                scale=float(f.get("scale", 1.0)) or 1.0,
                weight=float(f.get("weight", 0.0)),
                gate=bool(f.get("gate", False)),
                threshold=f.get("threshold"),
                cap=f.get("cap"),
            )
            for f in d["factors"]
        ]
        return cls(
            version=str(d["version"]),
            bias=float(d["bias"]),
            specs=specs,
            trained_on=int(d.get("trained_on", 0)),
            metrics=d.get("metrics") or {},
            trained_at=d.get("trained_at"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "bias": round(self.bias, 6),
            "trained_on": self.trained_on,
            "trained_at": self.trained_at,
            "metrics": self.metrics,
            "factors": [
                {
                    k: v
                    for k, v in asdict(s).items()
                    if v is not None and not (k == "gate" and not v)
                }
                for s in self.specs
            ],
        }

    @classmethod
    def prior(cls) -> VacancyModel:
        return cls.load(PRIOR_PATH)

    @classmethod
    def load(cls, path: str | Path) -> VacancyModel:
        with open(path) as f:
            return cls.from_dict(json.load(f))

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2) + "\n")

    # -- scoring --------------------------------------------------------------
    @property
    def weighted(self) -> list[FactorSpec]:
        return [s for s in self.specs if not s.gate]

    @staticmethod
    def zscore(spec: FactorSpec, value: float | None) -> float:
        if value is None:
            return 0.0
        return float(np.clip((value - spec.center) / spec.scale, -Z_CLIP, Z_CLIP))

    def score(self, fv: FactorVector) -> ScoreResult:
        factors: list[FactorScore] = []
        logit = self.bias
        for spec in self.weighted:
            value = fv.get(spec.name)
            z = self.zscore(spec, value)
            contribution = spec.weight * z
            logit += contribution
            factors.append(FactorScore(spec.name, spec.label, value, z, spec.weight, contribution))

        p = 1.0 / (1.0 + math.exp(-logit))
        gated = False
        for spec in self.specs:
            if not spec.gate:
                continue
            value = fv.get(spec.name)
            if value is not None and spec.threshold is not None and value < spec.threshold:
                p = min(p, float(spec.cap if spec.cap is not None else 0.4))
                gated = True
            factors.append(FactorScore(spec.name, spec.label, value, 0.0, 0.0, 0.0))

        drivers_pool = [f for f in factors if f.contribution > TOP_DRIVER_MIN]
        ranked = sorted(drivers_pool, key=lambda f: -f.contribution)
        drivers = [f.label for f in ranked[:3]]
        if gated:
            drivers.append("Registration too poor — score capped")
        return ScoreResult(
            probability=p,
            confidence=int(round(p * 100)),
            gated=gated,
            model_version=self.version,
            factors=factors,
            top_drivers=drivers,
        )

    # -- training -------------------------------------------------------------
    def design_matrix(self, X: list[FactorVector]) -> np.ndarray:
        specs = self.weighted
        return np.array(
            [[self.zscore(s, fv.get(s.name)) for s in specs] for fv in X], dtype=np.float64
        ).reshape(len(X), len(specs))

    def fit(
        self,
        X: list[FactorVector],
        y: list[int],
        *,
        prior_strength: float = 2.0,
        iterations: int = 800,
        learning_rate: float = 0.05,
        version: str | None = None,
    ) -> VacancyModel:
        """Refit weights and bias by gradient descent on log-loss with an L2
        penalty toward the current (prior) weights; returns a new model."""
        n = len(X)
        if n == 0 or n != len(y):
            raise ValueError("need matching, non-empty X and y")
        Z = self.design_matrix(X)
        t = np.asarray(y, dtype=np.float64)
        w0 = np.array([s.weight for s in self.weighted], dtype=np.float64)
        w, b = w0.copy(), self.bias
        lam = prior_strength / n
        for _ in range(iterations):
            p = 1.0 / (1.0 + np.exp(-(Z @ w + b)))
            grad_w = Z.T @ (p - t) / n + 2 * lam * (w - w0)
            grad_b = float((p - t).mean())
            w -= learning_rate * grad_w
            b -= learning_rate * grad_b
        p = 1.0 / (1.0 + np.exp(-(Z @ w + b)))
        eps = 1e-7
        log_loss = float(-(t * np.log(p + eps) + (1 - t) * np.log(1 - p + eps)).mean())
        accuracy = float(((p >= 0.5) == (t >= 0.5)).mean())

        specs = []
        wi = iter(w)
        for s in self.specs:
            specs.append(s if s.gate else FactorSpec(**{**asdict(s), "weight": float(next(wi))}))
        stamp = datetime.now(UTC).strftime("%Y%m%d")
        return VacancyModel(
            version=version or f"trained-{stamp}-n{n}",
            bias=float(b),
            specs=specs,
            trained_on=n,
            metrics={
                "log_loss": round(log_loss, 4),
                "accuracy": round(accuracy, 4),
                "positives": int(t.sum()),
            },
            trained_at=datetime.now(UTC).isoformat(timespec="seconds"),
        )
