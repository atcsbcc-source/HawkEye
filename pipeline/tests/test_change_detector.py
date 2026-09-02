from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest
from conftest import GREEN_BGR, make_textured_scene, shift_image

import change_detector as cd

# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------


def test_align_recovers_translation(textured_scene, shifted):
    curr = textured_scene
    prev = shifted(curr, 4, 3)
    warped, quality = cd.align_images(prev, curr)
    assert quality > 0.9
    valid = cd.validity_mask(warped, curr)
    # Ignore the replicated border strip the shift introduced.
    inner = np.zeros_like(valid)
    inner[10:-10, 10:-10] = True
    diff = np.abs(warped.astype(np.int16) - curr.astype(np.int16)).mean(axis=2)
    assert diff[valid & inner].mean() < 5


def test_align_returns_zero_on_featureless():
    flat = np.full((200, 200, 3), 120, dtype=np.uint8)
    warped, quality = cd.align_images(flat, flat.copy())
    assert quality == 0.0
    assert warped is flat  # prev returned unchanged


# ---------------------------------------------------------------------------
# Vegetation / validity / shadow masks
# ---------------------------------------------------------------------------


def test_exg_pure_green_vs_gray():
    green = np.zeros((1, 1, 3), dtype=np.uint8)
    green[0, 0] = (0, 255, 0)  # BGR
    gray = np.full((1, 1, 3), 100, dtype=np.uint8)
    assert cd.exg(green)[0, 0] == pytest.approx(2.0, abs=1e-4)
    assert cd.exg(gray)[0, 0] == pytest.approx(0.0, abs=1e-4)


def test_vegetation_mask_only_on_green_band(textured_scene):
    veg = cd.vegetation_mask(textured_scene, textured_scene)
    h = textured_scene.shape[0]
    assert veg[h // 2 :, :].mean() > 0.95
    # The colored rectangles can contain greenish pixels; the top half is mostly not vegetation.
    assert veg[: h // 2, :].mean() < 0.2


def test_validity_mask_excludes_nodata():
    prev = np.zeros((10, 10, 3), dtype=np.uint8)
    curr = np.zeros((10, 10, 3), dtype=np.uint8)
    prev[2:8, 2:8] = 200
    curr[2:8, 2:8] = 200
    valid = cd.validity_mask(prev, curr)
    assert valid.mean() == pytest.approx(0.36)

    # A warped black border in only one frame is excluded too.
    curr2 = np.full((10, 10, 3), 200, dtype=np.uint8)
    assert cd.validity_mask(prev, curr2).mean() == pytest.approx(0.36)


def test_shadow_mask_flags_luminance_only_change():
    lab_prev = np.zeros((4, 4, 3), dtype=np.uint8)
    lab_prev[:, :, 0] = 200
    lab_prev[:, :, 1] = 128
    lab_prev[:, :, 2] = 128
    # Halve L, keep a/b: shadow.
    lab_curr = lab_prev.copy()
    lab_curr[:, :, 0] = 100
    assert (cd.shadow_mask(lab_prev, lab_curr) == 255).all()
    # Same L drop but chroma moved by 40: real change, not shadow.
    lab_curr2 = lab_curr.copy()
    lab_curr2[:, :, 1] = 168
    assert (cd.shadow_mask(lab_prev, lab_curr2) == 0).all()


# ---------------------------------------------------------------------------
# Persistent change
# ---------------------------------------------------------------------------


def _masks(prev: np.ndarray, curr: np.ndarray):
    veg = cd.vegetation_mask(prev, curr)
    valid = cd.validity_mask(prev, curr)
    lab_prev, lab_curr = cd.normalize_illumination(prev, curr)
    shadows = cd.shadow_mask(lab_prev, lab_curr)
    return lab_prev, lab_curr, shadows, veg, valid


def test_persistent_change_identical_is_zero(textured_scene):
    mask, score = cd.persistent_change(*_masks(textured_scene, textured_scene.copy()))
    assert score == 0.0
    assert not mask.any()


def test_persistent_change_new_block_scores(textured_scene):
    prev = textured_scene
    curr = prev.copy()
    # A red 60x60 block on the pavement half: chroma moves, so it is neither a
    # shadow (luminance-only) nor vegetation (negative ExG).
    curr[40:100, 40:100] = (30, 30, 200)
    mask, score = cd.persistent_change(*_masks(prev, curr))
    assert score > 0
    assert mask[40:100, 40:100].mean() > 128
    outside = mask.copy()
    outside[30:110, 30:110] = 0  # tolerate blur/morphology bleed around the block
    assert not outside.any()


# ---------------------------------------------------------------------------
# Lawn growth index
# ---------------------------------------------------------------------------


def _greener(img: np.ndarray, factor: float) -> np.ndarray:
    out = img.astype(np.float32)
    out[:, :, 1] = np.clip(out[:, :, 1] * factor, 0, 255)
    return out.astype(np.uint8)


def test_lawn_growth_positive_when_greener(textured_scene):
    prev = textured_scene
    veg = cd.vegetation_mask(prev, prev)
    valid = cd.validity_mask(prev, prev)

    grown = _greener(prev, 1.35)
    lgi_up, details = cd.lawn_growth_index(prev, grown, veg, valid)
    assert lgi_up > 0
    assert set(details) >= {"vegetated_fraction", "greenness_delta", "texture_delta"}

    browned = _greener(prev, 0.7)
    lgi_down, _ = cd.lawn_growth_index(prev, browned, veg, valid)
    assert lgi_down < 0


def test_lawn_growth_zero_without_lawn():
    gray = np.full((100, 100, 3), 120, dtype=np.uint8)
    veg = cd.vegetation_mask(gray, gray)
    valid = cd.validity_mask(gray, gray)
    lgi, details = cd.lawn_growth_index(gray, gray, veg, valid)
    assert lgi == 0.0
    assert details == {"vegetated_fraction": 0.0}


# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------


def _pavement_with_rect(w_px: int, h_px: int, color=(30, 30, 200)) -> np.ndarray:
    img = np.full((400, 400, 3), 128, dtype=np.uint8)
    x0, y0 = 100, 100
    img[y0 : y0 + h_px, x0 : x0 + w_px] = color
    return img


def test_detect_vehicle_boxes_size_gate():
    img = _pavement_with_rect(180, 80)  # 4.5 m x 2.0 m at 2.5 cm/px
    veg = np.zeros((400, 400), dtype=bool)
    valid = np.ones((400, 400), dtype=bool)
    boxes = cd.detect_vehicle_boxes(img, 2.5, veg, valid)
    assert len(boxes) == 1
    x, y, w, h = boxes[0]
    assert abs(w - 180) <= 4 and abs(h - 80) <= 4

    # Same blob at 25 cm/px is a 45 m x 20 m building: rejected.
    assert cd.detect_vehicle_boxes(img, 25.0, veg, valid) == []


def test_detect_vehicle_boxes_aspect_and_vegetation_gates():
    veg = np.zeros((400, 400), dtype=bool)
    valid = np.ones((400, 400), dtype=bool)
    square = _pavement_with_rect(120, 120)  # aspect 1.0
    assert cd.detect_vehicle_boxes(square, 2.5, veg, valid) == []

    car = _pavement_with_rect(180, 80)
    on_lawn = veg.copy()
    on_lawn[100:180, 100:280] = True
    assert cd.detect_vehicle_boxes(car, 2.5, on_lawn, valid) == []


def test_vehicle_signals_static_iou():
    box = (100, 100, 180, 80)
    assert cd.vehicle_signals([box], [box]) == (True, True)
    moved = (100 + 180, 100, 180, 80)
    assert cd.vehicle_signals([box], [moved]) == (True, False)
    assert cd.vehicle_signals([], []) == (False, False)
    assert cd._iou(box, box) == 1.0


# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "lgi", "present", "static", "align", "expected"),
    [
        (0.0, 0.0, False, False, 1.0, 40),
        (0.0, 0.9, True, True, 0.1, 40),
        (0.0, 0.6, True, True, 1.0, 90),
        (12.0, 0.10, True, False, 1.0, 0),
    ],
)
def test_confidence_table(change, lgi, present, static, align, expected):
    assert cd.compute_vacancy_confidence(change, lgi, present, static, align) == expected


# ---------------------------------------------------------------------------
# I/O and orchestration
# ---------------------------------------------------------------------------


def test_load_image_scales_to_max_dim(tmp_path: Path):
    big = np.full((1024, 2048, 3), 90, dtype=np.uint8)
    path = tmp_path / "big.jpg"
    cv2.imwrite(str(path), big)
    img, scale = cd.load_image(path)
    assert scale == pytest.approx(0.5)
    assert max(img.shape[:2]) == 1024

    small = tmp_path / "small.jpg"
    cv2.imwrite(str(small), big[:200, :300])
    img2, scale2 = cd.load_image(small)
    assert scale2 == 1.0 and img2.shape[:2] == (200, 300)


def test_load_image_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        cd.load_image(tmp_path / "nope.jpg")


def test_analyze_pair_identical_frames(rng, tmp_pair):
    scene = make_textured_scene(rng)
    prev, curr = tmp_pair(scene, scene)
    result = cd.analyze_pair(prev, curr, gsd_cm=2.5)
    assert result.change_score == 0.0
    assert result.vehicle_present is False
    assert result.alignment_quality > 0.95
    assert 0 <= result.vacancy_confidence <= 100
    assert result.details["low_alignment"] is False


def test_analyze_pair_writes_debug_artifacts(rng, tmp_pair, tmp_path: Path):
    scene = make_textured_scene(rng)
    prev, curr = tmp_pair(shift_image(scene, 2, 1), scene)
    debug = tmp_path / "debug"
    result = cd.analyze_pair(prev, curr, gsd_cm=2.5, debug_dir=debug)
    names = sorted(p.name for p in debug.iterdir())
    assert names == ["aligned_prev.jpg", "change_mask.png", "overlay.jpg", "shadow_mask.png"]
    assert '"vacancy_confidence"' in result.to_json()


def test_green_constant_reads_as_vegetation():
    px = np.zeros((1, 1, 3), dtype=np.uint8)
    px[0, 0] = GREEN_BGR
    assert cd.exg(px)[0, 0] > 0.05
