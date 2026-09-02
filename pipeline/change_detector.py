#!/usr/bin/env python3
"""
HawkEye change detector.

Compares two sequential overhead crops of the same property (Week T-1 vs
Week T), aligns them with ORB feature matching + RANSAC homography, suppresses
transient differences (illumination, shadows), and emits the numerical signals
stored in `property_scans`:

  * alignment_quality   0-1   RANSAC inlier ratio (trust gate for everything else)
  * change_score        0-100 % of the frame with persistent structural change
  * lawn_growth_index   -1..1 vegetation overgrowth vs previous week (ExG + texture)
  * vehicle_present     bool  car-sized blob detected in the current frame
  * vehicle_static      bool  same vehicle in the same spot both weeks
  * vacancy_confidence  0-100 weighted composite (see compute_vacancy_confidence)

Usage:
  python change_detector.py --prev week_t-1.jpg --curr week_t.jpg \
      --gsd-cm 2.5 --debug-dir debug_out/ --out result.json
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Tunables — calibrate against your own flight data.
# ---------------------------------------------------------------------------
MAX_DIM = 1024  # working resolution (longest edge)
ORB_FEATURES = 4000
LOWE_RATIO = 0.75
MIN_MATCHES = 12  # below this, alignment is untrusted
DIFF_BLUR_KSIZE = 7
DIFF_THRESHOLD = 28  # abs L*-channel delta considered "changed"
MORPH_KERNEL = 9  # opening kernel; kills speckle/transient noise
SHADOW_L_DROP = 0.55  # luminance ratio below which a darkening pixel
SHADOW_CHROMA_TOL = 22  #   with near-unchanged chroma is called shadow
VEHICLE_AREA_M2 = (5.5, 32.0)  # plausible car/truck footprint
VEHICLE_ASPECT = (1.3, 4.0)  # length/width of a minAreaRect
VEHICLE_RECTANGULARITY = 0.55  # contour area / minAreaRect area
VEHICLE_L_DELTA = 30  # L* deviation from pavement median = candidate
VEHICLE_CHROMA_DELTA = 22  # chroma deviation from pavement median = candidate
NODATA_GRAY = 8  # pixels darker than this are ortho nodata border
STATIC_IOU = 0.45  # box IoU across weeks to call a vehicle static
FLAG_LOW_ALIGNMENT = 0.30  # below this inlier ratio, cap confidence


@dataclass
class ScanResult:
    alignment_quality: float
    change_score: float
    lawn_growth_index: float
    vehicle_present: bool
    vehicle_static: bool
    vacancy_confidence: int
    details: dict = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)


# ---------------------------------------------------------------------------
# Loading & alignment
# ---------------------------------------------------------------------------
def load_image(path: str | Path, max_dim: int = MAX_DIM) -> tuple[np.ndarray, float]:
    """Load and cap to max_dim. Returns (image, scale) — callers must divide
    the source GSD by `scale` so metric size filters stay correct."""
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {path}")
    h, w = img.shape[:2]
    scale = max_dim / max(h, w)
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        return img, scale
    return img, 1.0


def align_images(prev: np.ndarray, curr: np.ndarray) -> tuple[np.ndarray, float]:
    """Warp `prev` into `curr`'s frame via ORB + RANSAC homography.

    Returns (warped_prev, alignment_quality). On failure returns the unwarped
    previous frame with quality 0.0 — downstream scoring caps confidence.
    """
    gray_prev = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    gray_curr = cv2.cvtColor(curr, cv2.COLOR_BGR2GRAY)

    orb = cv2.ORB_create(nfeatures=ORB_FEATURES)
    kp1, des1 = orb.detectAndCompute(gray_prev, None)
    kp2, des2 = orb.detectAndCompute(gray_curr, None)
    if des1 is None or des2 is None or len(kp1) < MIN_MATCHES or len(kp2) < MIN_MATCHES:
        return prev, 0.0

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    raw = matcher.knnMatch(des1, des2, k=2)
    good = [
        m
        for pair in raw
        if len(pair) == 2
        for m, n in [pair]
        if m.distance < LOWE_RATIO * n.distance
    ]
    if len(good) < MIN_MATCHES:
        return prev, 0.0

    src = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, inlier_mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    if H is None:
        return prev, 0.0

    quality = float(inlier_mask.sum()) / len(good)
    h, w = curr.shape[:2]
    warped = cv2.warpPerspective(prev, H, (w, h))
    return warped, quality


# ---------------------------------------------------------------------------
# Illumination normalization & shadow suppression
# ---------------------------------------------------------------------------
def normalize_illumination(a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """CLAHE-equalize L channels and match mean luminance so a sunny-vs-overcast
    pair doesn't read as wholesale change."""
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    out = []
    for img in (a, b):
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        lab[:, :, 0] = clahe.apply(lab[:, :, 0])
        out.append(lab)
    la, lb = out
    # Match mean L of b to a.
    mean_a, mean_b = la[:, :, 0].mean(), lb[:, :, 0].mean()
    if mean_b > 1:
        lb[:, :, 0] = np.clip(lb[:, :, 0].astype(np.float32) * (mean_a / mean_b), 0, 255).astype(
            np.uint8
        )
    return la, lb


def shadow_mask(lab_prev: np.ndarray, lab_curr: np.ndarray) -> np.ndarray:
    """Pixels that darkened (or brightened) sharply while chroma stayed put are
    cast-shadow edges moving with the sun, not scene change. Returns a uint8
    mask (255 = shadow, exclude from diff)."""
    l0 = lab_prev[:, :, 0].astype(np.float32) + 1.0
    l1 = lab_curr[:, :, 0].astype(np.float32) + 1.0
    ratio = np.minimum(l0, l1) / np.maximum(l0, l1)

    chroma_delta = cv2.absdiff(lab_prev[:, :, 1], lab_curr[:, :, 1]).astype(
        np.float32
    ) + cv2.absdiff(lab_prev[:, :, 2], lab_curr[:, :, 2]).astype(np.float32)
    mask = (ratio < SHADOW_L_DROP) & (chroma_delta < SHADOW_CHROMA_TOL)
    return (mask.astype(np.uint8)) * 255


# ---------------------------------------------------------------------------
# Vegetation helpers
# ---------------------------------------------------------------------------
def exg(img: np.ndarray) -> np.ndarray:
    """Excess-green index (2g - r - b on chromatic coordinates)."""
    f = img.astype(np.float32) + 1e-6
    s = f.sum(axis=2)
    b, g, r = f[:, :, 0] / s, f[:, :, 1] / s, f[:, :, 2] / s
    return 2.0 * g - r - b


def vegetation_mask(prev: np.ndarray, curr: np.ndarray) -> np.ndarray:
    """Union of vegetated pixels across both weeks (boolean). Vegetation change
    is scored by the lawn growth index; everything else treats it as clutter."""
    return (exg(prev) > 0.05) | (exg(curr) > 0.05)


def validity_mask(prev: np.ndarray, curr: np.ndarray) -> np.ndarray:
    """Pixels with real imagery in BOTH frames. Ortho crops near the coverage
    boundary (and warped previous frames) carry black nodata borders that would
    otherwise poison every statistic downstream."""
    g_prev = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    g_curr = cv2.cvtColor(curr, cv2.COLOR_BGR2GRAY)
    return (g_prev > NODATA_GRAY) & (g_curr > NODATA_GRAY)


# ---------------------------------------------------------------------------
# Persistent structural change
# ---------------------------------------------------------------------------
def persistent_change(
    lab_prev: np.ndarray,
    lab_curr: np.ndarray,
    shadows: np.ndarray,
    vegetation: np.ndarray,
    valid: np.ndarray,
) -> tuple[np.ndarray, float]:
    """Absolute diff on normalized L + chroma — shadow- and vegetation-masked,
    blurred, and morphologically opened so only persistent *structural*
    differences survive (vegetation change is the lawn index's job).
    Returns (binary mask, change_score 0-100)."""
    diff = cv2.absdiff(lab_prev, lab_curr).astype(np.float32)
    # Weight chroma higher: material change shifts color, lighting mostly doesn't.
    combined = 0.5 * diff[:, :, 0] + 1.0 * diff[:, :, 1] + 1.0 * diff[:, :, 2]
    combined = cv2.GaussianBlur(combined, (DIFF_BLUR_KSIZE, DIFF_BLUR_KSIZE), 0)

    mask = (combined > DIFF_THRESHOLD).astype(np.uint8) * 255
    mask[shadows > 0] = 0
    mask[vegetation] = 0
    mask[~valid] = 0

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (MORPH_KERNEL, MORPH_KERNEL))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    # Score over the valid non-vegetated area so a big lawn doesn't dilute it.
    denom = max(1, int(((~vegetation) & valid).sum()))
    score = 100.0 * float((mask > 0).sum()) / denom
    return mask, round(min(score, 100.0), 2)


# ---------------------------------------------------------------------------
# Lawn growth index
# ---------------------------------------------------------------------------
def lawn_growth_index(
    prev: np.ndarray, curr: np.ndarray, veg: np.ndarray, valid: np.ndarray
) -> tuple[float, dict]:
    """Excess-green vegetation index plus texture (Laplacian variance) over the
    vegetated region.

    Overgrown, unmowed turf is both greener-relative and rougher than a
    maintained lawn; the index is the blended week-over-week delta, clamped
    to [-1, 1]. Positive = growth/neglect, negative = fresh mow or die-off.

    Greenness is center-weighted (Gaussian) because crops are centered on the
    parcel centroid — neighboring lots at the edges shouldn't dilute the signal.
    """
    exg_prev, exg_curr = exg(prev), exg(curr)
    veg = veg & valid
    if veg.mean() < 0.02:  # no lawn in frame
        return 0.0, {"vegetated_fraction": round(float(veg.mean()), 4)}

    h, w = veg.shape
    gy = np.exp(-0.5 * ((np.arange(h) - h / 2) / (0.30 * h)) ** 2)
    gx = np.exp(-0.5 * ((np.arange(w) - w / 2) / (0.30 * w)) ** 2)
    weights = np.outer(gy, gx) * veg
    wsum = weights.sum() + 1e-6
    greenness_delta = float(((exg_curr - exg_prev) * weights).sum() / wsum)

    def texture(img: np.ndarray) -> float:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        lap = cv2.Laplacian(gray, cv2.CV_32F)
        return float(lap[veg].var())

    t_prev, t_curr = texture(prev), texture(curr)
    texture_delta = (t_curr - t_prev) / (t_prev + t_curr + 1e-6)  # ~[-1, 1]

    lgi = float(np.clip(3.0 * greenness_delta + 0.5 * texture_delta, -1.0, 1.0))
    return round(lgi, 3), {
        "vegetated_fraction": round(float(veg.mean()), 4),
        "greenness_delta": round(greenness_delta, 4),
        "texture_delta": round(texture_delta, 4),
    }


# ---------------------------------------------------------------------------
# Vehicle presence / persistence
# ---------------------------------------------------------------------------
def detect_vehicle_boxes(
    img: np.ndarray, gsd_cm: float, vegetation: np.ndarray, valid: np.ndarray
) -> list[tuple[int, int, int, int]]:
    """Heuristic car detector: car-footprint, roughly rectangular blobs whose
    color stands out from the surrounding pavement (L* or chroma deviation from
    the non-vegetated median). Color segmentation survives pavement-joint and
    curb clutter that defeats edge-based contouring; its known blind spot is a
    gray car on gray pavement — swap in a YOLO detector behind this signature
    for production without touching callers."""
    px_per_m = 100.0 / gsd_cm
    area_px = (VEHICLE_AREA_M2[0] * px_per_m**2, VEHICLE_AREA_M2[1] * px_per_m**2)

    stat = (~vegetation) & valid  # pavement/roof pixels with real data
    if stat.mean() < 0.01:
        return []
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    median_l = np.median(lab[:, :, 0][stat])
    chroma = np.abs(lab[:, :, 1] - 128) + np.abs(lab[:, :, 2] - 128)
    median_chroma = np.median(chroma[stat])

    candidates = (
        (np.abs(lab[:, :, 0] - median_l) > VEHICLE_L_DELTA)
        | (chroma - median_chroma > VEHICLE_CHROMA_DELTA)
    ) & stat

    mask = candidates.astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in contours:
        area = cv2.contourArea(c)
        if not (area_px[0] <= area <= area_px[1]):
            continue
        (cx, cy), (rw, rh), _angle = cv2.minAreaRect(c)
        if min(rw, rh) < 1:
            continue
        aspect = max(rw, rh) / min(rw, rh)
        if not (VEHICLE_ASPECT[0] <= aspect <= VEHICLE_ASPECT[1]):
            continue
        if area / (rw * rh) < VEHICLE_RECTANGULARITY:
            continue
        boxes.append(tuple(cv2.boundingRect(c)))
    return boxes


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a[0], a[1], a[0] + a[2], a[1] + a[3]
    bx1, by1, bx2, by2 = b[0], b[1], b[0] + b[2], b[1] + b[3]
    ix = max(0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union else 0.0


def vehicle_signals(prev_boxes: list, curr_boxes: list) -> tuple[bool, bool]:
    present = len(curr_boxes) > 0
    static = any(_iou(p, c) >= STATIC_IOU for p in prev_boxes for c in curr_boxes)
    return present, static


# ---------------------------------------------------------------------------
# Composite confidence
# ---------------------------------------------------------------------------
def compute_vacancy_confidence(
    change_score: float,
    lgi: float,
    vehicle_present: bool,
    vehicle_static: bool,
    alignment_quality: float,
) -> int:
    """Weighted heuristic, 0-100. A vacant property reads as: lawn overgrowing,
    a vehicle that never moves (or none at all), and little other week-over-week
    activity. Weights are a starting point — tune against ground-truthed leads.
    """
    score = 0.0
    # Overgrowth: up to 40 pts once LGI clears the noise floor of 0.10.
    if lgi > 0.10:
        score += 40.0 * min(1.0, (lgi - 0.10) / 0.40)
    # Vehicle behavior: a never-moving car is a strong signal; an empty
    # driveway both weeks is a weak one; a car that came/went is activity.
    if vehicle_static:
        score += 20.0
    elif not vehicle_present:
        score += 10.0
    # Stillness: little persistent change outside vegetation suggests nobody
    # is home. Full 30 pts at 0% change, tapering to 0 at 12%+.
    score += 30.0 * max(0.0, 1.0 - change_score / 12.0)
    # Trust gate: poor alignment means every signal above is suspect.
    if alignment_quality < FLAG_LOW_ALIGNMENT:
        score = min(score, 40.0)
    else:
        score *= 0.6 + 0.4 * alignment_quality
    return int(round(np.clip(score, 0, 100)))


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def analyze_pair(
    prev_path: str | Path,
    curr_path: str | Path,
    gsd_cm: float = 2.5,
    debug_dir: str | Path | None = None,
) -> ScanResult:
    prev, _ = load_image(prev_path)
    curr, curr_scale = load_image(curr_path)
    if prev.shape != curr.shape:
        prev = cv2.resize(prev, (curr.shape[1], curr.shape[0]))
    # Everything is scored in the (possibly downsized) current frame, so the
    # effective ground resolution grows by the resize factor.
    gsd_cm = gsd_cm / curr_scale

    warped_prev, quality = align_images(prev, curr)
    veg = vegetation_mask(warped_prev, curr)
    valid = validity_mask(warped_prev, curr)
    lab_prev, lab_curr = normalize_illumination(warped_prev, curr)
    shadows = shadow_mask(lab_prev, lab_curr)
    change_mask, change_score = persistent_change(lab_prev, lab_curr, shadows, veg, valid)
    lgi, lawn_details = lawn_growth_index(warped_prev, curr, veg, valid)

    prev_boxes = detect_vehicle_boxes(warped_prev, gsd_cm, veg, valid)
    curr_boxes = detect_vehicle_boxes(curr, gsd_cm, veg, valid)
    vehicle_present, vehicle_static = vehicle_signals(prev_boxes, curr_boxes)

    confidence = compute_vacancy_confidence(
        change_score, lgi, vehicle_present, vehicle_static, quality
    )

    if debug_dir:
        debug = Path(debug_dir)
        debug.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(debug / "aligned_prev.jpg"), warped_prev)
        cv2.imwrite(str(debug / "shadow_mask.png"), shadows)
        cv2.imwrite(str(debug / "change_mask.png"), change_mask)
        overlay = curr.copy()
        overlay[change_mask > 0] = (0, 0, 255)
        for x, y, w, h in curr_boxes:
            cv2.rectangle(overlay, (x, y), (x + w, y + h), (0, 255, 255), 2)
        cv2.imwrite(str(debug / "overlay.jpg"), cv2.addWeighted(curr, 0.6, overlay, 0.4, 0))

    return ScanResult(
        alignment_quality=round(quality, 3),
        change_score=change_score,
        lawn_growth_index=lgi,
        vehicle_present=vehicle_present,
        vehicle_static=vehicle_static,
        vacancy_confidence=confidence,
        details={
            "lawn": lawn_details,
            "vehicle_boxes_prev": prev_boxes,
            "vehicle_boxes_curr": curr_boxes,
            "shadow_fraction": round(float((shadows > 0).mean()), 4),
            "low_alignment": quality < FLAG_LOW_ALIGNMENT,
        },
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="HawkEye week-over-week property change detector")
    ap.add_argument("--prev", required=True, help="Week T-1 crop")
    ap.add_argument("--curr", required=True, help="Week T crop")
    ap.add_argument(
        "--gsd-cm",
        type=float,
        default=2.5,
        help="Ground sample distance of the crops, cm/px (default 2.5)",
    )
    ap.add_argument("--debug-dir", default=None, help="Write masks/overlays here")
    ap.add_argument("--out", default=None, help="Write result JSON here (default stdout)")
    args = ap.parse_args()

    result = analyze_pair(args.prev, args.curr, gsd_cm=args.gsd_cm, debug_dir=args.debug_dir)
    payload = result.to_json()
    if args.out:
        Path(args.out).write_text(payload)
    print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
