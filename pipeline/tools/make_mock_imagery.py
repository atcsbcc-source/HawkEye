#!/usr/bin/env python3
"""
Generate the dashboard's mock overhead imagery.

Renders a synthetic nadir crop (lawn, roof, driveway, optional vehicle) for each
mock property and week W31..W35, then runs the real change detector on every
consecutive pair so each scan also gets an authentic diff overlay. Output lands
in dashboard/public/mock/<property_id>/ as w<NN>.jpg and w<NN>-diff.jpg, which
dashboard/lib/mock.ts references.

Usage:  python pipeline/tools/make_mock_imagery.py [--out dashboard/public/mock]
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from change_detector import analyze_pair  # noqa: E402

W, H = 640, 480
GSD_CM = 6.0  # ~40 m crop at 640 px
WEEKS = (31, 32, 33, 34, 35)
JPEG_QUALITY = 88


@dataclass(frozen=True)
class Scene:
    property_id: str
    seed: int
    roof: tuple[int, int, int, int]  # x, y, w, h
    driveway: tuple[int, int, int, int]
    roof_bgr: tuple[int, int, int]
    vehicle: str | None  # None | "static" | "moving"
    overgrowth: tuple[float, ...]  # one value in [0, 1] per week
    shadow_dir: int  # +1 / -1: which side the roof shadow falls


# Mirrors dashboard/lib/mock.ts: flagged parcels overgrow week over week,
# m2 keeps a static sedan, m5 is an occupied home (mowed, car comes and goes).
SCENES = (
    Scene(
        "m1",
        11,
        (200, 130, 230, 200),
        (430, 200, 190, 110),
        (95, 80, 70),
        None,
        (0.10, 0.35, 0.55, 0.75, 0.95),
        +1,
    ),
    Scene(
        "m2",
        23,
        (170, 150, 250, 190),
        (60, 250, 110, 200),
        (70, 82, 98),
        "static",
        (0.20, 0.35, 0.50, 0.65, 0.80),
        -1,
    ),
    Scene(
        "m3",
        37,
        (240, 110, 200, 220),
        (450, 160, 160, 120),
        (90, 90, 96),
        None,
        (0.05, 0.10, 0.25, 0.45, 0.60),
        +1,
    ),
    Scene(
        "m4",
        41,
        (150, 120, 300, 210),
        (460, 210, 170, 120),
        (100, 85, 75),
        None,
        (0.60, 0.75, 0.85, 0.95, 1.00),
        +1,
    ),
    Scene(
        "m5",
        53,
        (210, 140, 230, 190),
        (450, 190, 180, 110),
        (88, 78, 72),
        "moving",
        (0.05, 0.10, 0.05, 0.08, 0.05),
        -1,
    ),
    Scene(
        "m6",
        67,
        (190, 160, 240, 180),
        (60, 200, 120, 180),
        (80, 86, 92),
        None,
        (0.15, 0.30, 0.45, 0.55, 0.70),
        +1,
    ),
)


def _structure(rng: np.random.Generator) -> np.ndarray:
    """Persistent low-frequency mottling so ORB has stable features week to week."""
    coarse = rng.integers(-22, 22, (H // 8, W // 8, 3)).astype(np.float32)
    return cv2.resize(coarse, (W, H), interpolation=cv2.INTER_CUBIC)


def render(scene: Scene, week_idx: int, structure: np.ndarray) -> np.ndarray:
    rng = np.random.default_rng(scene.seed * 100 + week_idx)
    level = scene.overgrowth[week_idx]

    # Lawn: maintained turf is a muted green; neglect pushes greener and rougher.
    lawn = np.array((58, 118, 88), np.float32) + np.array((-10, 34, -12), np.float32) * level
    img = np.full((H, W, 3), lawn, np.float32) + structure + rng.normal(0, 4, (H, W, 3))
    weeds = rng.random((H, W)) > (1.0 - 0.22 * level)
    img[weeds] += np.array((-18, 42, -20), np.float32)
    img = np.clip(img, 0, 255).astype(np.uint8)

    x, y, w, h = scene.roof
    dx = scene.shadow_dir * (10 + 3 * week_idx)  # sun moves a little each sortie
    cv2.rectangle(img, (x + dx, y + 8), (x + w + dx, y + h + 8), (28, 34, 40), -1)  # shadow
    cv2.rectangle(img, (x, y), (x + w, y + h), scene.roof_bgr, -1)
    ridge = tuple(min(255, c + 45) for c in scene.roof_bgr)
    cv2.line(img, (x, y + h // 2), (x + w, y + h // 2), ridge, 3)
    cv2.line(img, (x + w // 2, y), (x + w // 2, y + h), ridge, 2)

    dxw, dyw, dww, dhw = scene.driveway
    cv2.rectangle(img, (dxw, dyw), (dxw + dww, dyw + dhw), (118, 116, 118), -1)
    step = 38 if dww > dhw else 34
    if dww > dhw:
        for jx in range(dxw + step, dxw + dww, step):
            cv2.line(img, (jx, dyw), (jx, dyw + dhw), (96, 94, 98), 1)
    else:
        for jy in range(dyw + step, dyw + dhw, step):
            cv2.line(img, (dxw, jy), (dxw + dww, jy), (96, 94, 98), 1)

    # 4.6 m x 2.0 m car at GSD_CM -> ~77 x 33 px, oriented along the driveway.
    car_l, car_w = int(460 / GSD_CM), int(200 / GSD_CM)
    if scene.vehicle == "static" or (scene.vehicle == "moving" and week_idx % 2 == 0):
        if dww > dhw:
            cx = dxw + 20 + (0 if scene.vehicle == "static" else 8 * week_idx)
            cy = dyw + (dhw - car_w) // 2
            body = (cx, cy, cx + car_l, cy + car_w)
        else:
            cx = dxw + (dww - car_w) // 2
            cy = dyw + 20 + (0 if scene.vehicle == "static" else 8 * week_idx)
            body = (cx, cy, cx + car_w, cy + car_l)
        cv2.rectangle(img, body[:2], body[2:], (150, 40, 30), -1)
        inset = 5
        cv2.rectangle(
            img,
            (body[0] + inset, body[1] + inset),
            (body[2] - inset, body[3] - inset),
            (190, 70, 60),
            -1,
        )

    # Sidewalk strip along the bottom edge with expansion joints.
    cv2.rectangle(img, (0, H - 34), (W, H - 8), (140, 140, 145), -1)
    for jx in range(0, W, 60):
        cv2.line(img, (jx, H - 34), (jx, H - 8), (105, 105, 110), 2)

    # Per-sortie exposure and a small GPS/heading offset for the aligner to absorb.
    gain, bias = 1.0 + rng.uniform(-0.07, 0.07), rng.uniform(-8, 8)
    img = cv2.convertScaleAbs(img, alpha=gain, beta=bias)
    m = np.float32([[1, 0, rng.uniform(-4, 4)], [0, 1, rng.uniform(-4, 4)]])
    return cv2.warpAffine(img, m, (W, H), borderMode=cv2.BORDER_REFLECT)


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate HawkEye mock overhead imagery")
    ap.add_argument("--out", type=Path, default=Path("dashboard/public/mock"))
    args = ap.parse_args()

    for scene in SCENES:
        out = args.out / scene.property_id
        out.mkdir(parents=True, exist_ok=True)
        structure = _structure(np.random.default_rng(scene.seed))
        paths: list[Path] = []
        for i, week in enumerate(WEEKS):
            path = out / f"w{week}.jpg"
            frame = render(scene, i, structure)
            cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            paths.append(path)

        for prev, curr, week in zip(paths[:-1], paths[1:], WEEKS[1:], strict=True):
            with tempfile.TemporaryDirectory() as tmp:
                result = analyze_pair(prev, curr, gsd_cm=GSD_CM, debug_dir=tmp)
                shutil.copyfile(Path(tmp) / "overlay.jpg", out / f"w{week}-diff.jpg")
            print(
                f"{scene.property_id} W{week}: confidence={result.vacancy_confidence:>3} "
                f"lgi={result.lawn_growth_index:+.2f} change={result.change_score:.1f}% "
                f"vehicle={'static' if result.vehicle_static else result.vehicle_present}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
