"""Shared synthetic fixtures for the CV pipeline tests. No real imagery, no network."""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

# Safety net so `python -m pytest pipeline/tests` works from the repo root
# even without the pyproject `pythonpath` setting being picked up.
sys.path.insert(0, str(Path(__file__).parents[1]))

GREEN_BGR = (40, 150, 40)


def make_textured_scene(rng: np.random.Generator, h: int = 400, w: int = 400) -> np.ndarray:
    """Gray 'pavement' with strong texture for ORB, plus a green band in the bottom half.

    Random gray noise gives thousands of corners; 120 colored rectangles give
    matchable structure at multiple scales; the green band is lawn.
    """
    img = rng.integers(90, 170, size=(h, w, 3), dtype=np.uint8)
    img[:] = img[:, :, :1]  # neutral gray (r=g=b) so it never reads as vegetation
    for _ in range(120):
        x, y = int(rng.integers(0, w - 20)), int(rng.integers(0, h - 20))
        rw, rh = int(rng.integers(6, 20)), int(rng.integers(6, 20))
        color = tuple(int(c) for c in rng.integers(0, 255, size=3))
        cv2.rectangle(img, (x, y), (x + rw, y + rh), color, -1)
    band = img[h // 2 :, :, :]
    band[:] = np.array(GREEN_BGR, dtype=np.uint8)
    noise = rng.integers(-15, 15, size=band.shape, dtype=np.int16)
    img[h // 2 :, :, :] = np.clip(band.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return img


def shift_image(img: np.ndarray, dx: float, dy: float) -> np.ndarray:
    m = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), borderMode=cv2.BORDER_REPLICATE)


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(1234)


@pytest.fixture
def textured_scene(rng: np.random.Generator) -> np.ndarray:
    return make_textured_scene(rng)


@pytest.fixture
def shifted():
    return shift_image


@pytest.fixture
def tmp_pair(tmp_path: Path):
    """Write (prev, curr) as JPEGs and return their paths."""

    def _write(prev: np.ndarray, curr: np.ndarray) -> tuple[Path, Path]:
        p, c = tmp_path / "previous.jpg", tmp_path / "current.jpg"
        cv2.imwrite(str(p), prev, [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(str(c), curr, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return p, c

    return _write


# Synthetic ortho: 400x400 px, 3-band uint8, EPSG:32617 (UTM 17N), 0.5 m/px.
GEOTIFF_ORIGIN = (513_000.0, 3_898_000.0)  # (west, north) in metres
GEOTIFF_RES = 0.5
GEOTIFF_SIZE = 400


@pytest.fixture
def synthetic_geotiff(tmp_path: Path, rng: np.random.Generator) -> Path:
    import rasterio
    from rasterio.transform import from_origin

    path = tmp_path / "ortho.tif"
    data = rng.integers(20, 235, size=(3, GEOTIFF_SIZE, GEOTIFF_SIZE), dtype=np.uint8)
    # Deterministic gradient on band 1 so a pixel's value encodes its position.
    data[0] = (np.arange(GEOTIFF_SIZE)[None, :] % 256).astype(np.uint8)
    transform = from_origin(GEOTIFF_ORIGIN[0], GEOTIFF_ORIGIN[1], GEOTIFF_RES, GEOTIFF_RES)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=GEOTIFF_SIZE,
        width=GEOTIFF_SIZE,
        count=3,
        dtype="uint8",
        crs="EPSG:32617",
        transform=transform,
    ) as dst:
        dst.write(data)
    return path
