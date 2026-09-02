from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest
import rasterio
from conftest import GEOTIFF_ORIGIN, GEOTIFF_RES, GEOTIFF_SIZE
from rasterio.transform import from_origin
from rasterio.warp import transform as warp_transform

import crop_parcels as cp


def _center_latlng(ds: rasterio.DatasetReader) -> tuple[float, float]:
    # Centre of pixel (200, 200), not the boundary between pixels, so the
    # EPSG:4326 round-trip cannot flip it into the neighbouring column.
    cx = GEOTIFF_ORIGIN[0] + GEOTIFF_RES * (GEOTIFF_SIZE / 2 + 0.5)
    cy = GEOTIFF_ORIGIN[1] - GEOTIFF_RES * (GEOTIFF_SIZE / 2 + 0.5)
    lngs, lats = warp_transform(ds.crs, "EPSG:4326", [cx], [cy])
    return lats[0], lngs[0]


def test_meters_per_pixel_projected(synthetic_geotiff: Path):
    with rasterio.open(synthetic_geotiff) as ds:
        assert cp.meters_per_pixel(ds, 35.0) == ds.res == (0.5, 0.5)


def test_meters_per_pixel_geographic(tmp_path: Path):
    path = tmp_path / "geo.tif"
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=10,
        width=10,
        count=1,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_origin(-80.85, 35.24, 1e-5, 1e-5),
    ) as dst:
        dst.write(np.zeros((1, 10, 10), dtype=np.uint8))
    with rasterio.open(path) as ds:
        mx, my = cp.meters_per_pixel(ds, 35.23)
    assert mx == pytest.approx(1.1132 * math.cos(math.radians(35.23)), rel=1e-3)
    assert my == pytest.approx(1.1054, rel=1e-3)


def test_crop_parcel_center(synthetic_geotiff: Path):
    with rasterio.open(synthetic_geotiff) as ds:
        lat, lng = _center_latlng(ds)
        crop = cp.crop_parcel(ds, lat, lng, 22.0)
        assert crop is not None
        assert crop.shape == (88, 88, 3)
        # Band 1 encodes the column index, so the crop centre must be the raster centre.
        src = ds.read(1)
        assert int(crop[44, 44, 0]) == int(src[200, 200])


def test_crop_parcel_edge_is_boundless_zero_filled(synthetic_geotiff: Path):
    with rasterio.open(synthetic_geotiff) as ds:
        # 2 px inside the western edge, vertically centred.
        x = GEOTIFF_ORIGIN[0] + 2 * GEOTIFF_RES
        y = GEOTIFF_ORIGIN[1] - GEOTIFF_RES * GEOTIFF_SIZE / 2
        lngs, lats = warp_transform(ds.crs, "EPSG:4326", [x], [y])
        crop = cp.crop_parcel(ds, lats[0], lngs[0], 22.0)
        assert crop is not None
        assert crop.shape == (88, 88, 3)
        assert not crop[:, :40, :].any()  # left of the raster: fill 0
        assert crop[:, 50:, :].any()


def test_crop_parcel_outside_extent_returns_none(synthetic_geotiff: Path):
    with rasterio.open(synthetic_geotiff) as ds:
        lat, lng = _center_latlng(ds)
        assert cp.crop_parcel(ds, lat + 1.0, lng, 22.0) is None
        # Regression (DX-04): a 0,0 placeholder is outside the UTM zone's
        # projection domain and used to raise from rasterio, aborting the run.
        assert cp.crop_parcel(ds, 0.0, 0.0, 22.0) is None


def test_load_parcels_csv_coerces(tmp_path: Path):
    csv_path = tmp_path / "parcels.csv"
    csv_path.write_text("parcel_id,lat,lng\n042-001,35.2312,-80.848\n042-002, 35.5 ,-80.9\n")
    rows = cp.load_parcels_csv(csv_path)
    assert rows == [
        {"parcel_id": "042-001", "lat": 35.2312, "lng": -80.848},
        {"parcel_id": "042-002", "lat": 35.5, "lng": -80.9},
    ]
    assert isinstance(rows[0]["lat"], float)


@pytest.mark.parametrize(
    ("row", "fragment"),
    [
        ("042-003,-95.0,35.2312", "line 3"),  # names the offending CSV line
        ("042-004,95,10", "out of range"),
        ("042-005,abc,10", "must be numbers"),
        (",35,10", "parcel_id is empty"),
    ],
)
def test_load_parcels_csv_range_errors(tmp_path: Path, row: str, fragment: str):
    csv_path = tmp_path / "parcels.csv"
    csv_path.write_text(f"parcel_id,lat,lng\n042-001,35.0,-80.0\n{row}\n")
    with pytest.raises(ValueError, match=fragment):
        cp.load_parcels_csv(csv_path)
