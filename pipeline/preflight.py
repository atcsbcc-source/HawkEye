#!/usr/bin/env python3
"""
HawkEye pre-flight check: is this machine ready to process a sortie?

  python preflight.py                      # environment, deps, model, Supabase, storage
  python preflight.py --flight-code FLT-2026-W36-OAKWOOD --data-dir data/
                                           # + the flight row exists and crops are staged

Prints one PASS / WARN / FAIL line per check and exits 1 on any FAIL, so it can
gate a field-day script. Never prints secret values.
"""

from __future__ import annotations

import argparse
import contextlib
import importlib
import os
import shutil
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from settings import load_env

MIN_FREE_GB = 2.0


@dataclass
class Check:
    name: str
    status: str  # PASS | WARN | FAIL
    detail: str = ""

    def line(self) -> str:
        return f"[{self.status:4}] {self.name:<28} {self.detail}".rstrip()


def check_dependencies(offline: bool = False) -> list[Check]:
    """Core CV deps must import; the Supabase client is only a warning offline."""
    out = []
    for mod, why, online_only in (
        ("cv2", "change detection", False),
        ("numpy", "numerics", False),
        ("rasterio", "ortho cropping", False),
        ("supabase", "uploads / upserts", True),
        ("dotenv", ".env loading", True),
    ):
        try:
            importlib.import_module(mod)
            out.append(Check(f"python: {mod}", "PASS", why))
        except ImportError:
            status = "WARN" if (offline and online_only) else "FAIL"
            out.append(
                Check(f"python: {mod}", status, f"missing ({why}) — pip install -e '.[dev]'")
            )
    return out


def check_env(env: dict[str, str] | None = None) -> list[Check]:
    e = os.environ if env is None else env
    out = []
    url = e.get("SUPABASE_URL", "").strip()
    if not url:
        out.append(Check("env: SUPABASE_URL", "FAIL", "not set — copy .env.example to .env"))
    elif not url.startswith("https://"):
        out.append(Check("env: SUPABASE_URL", "FAIL", "must be https://"))
    else:
        out.append(Check("env: SUPABASE_URL", "PASS", url.split("//", 1)[1].split("/")[0]))
    key = e.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    out.append(
        Check(
            "env: SUPABASE_SERVICE_ROLE_KEY",
            "PASS" if len(key) > 20 else "FAIL",
            "present" if len(key) > 20 else "not set",
        )
    )
    dash = e.get("DASHBOARD_URL", "").strip()
    token = e.get("HAWKEYE_PIPELINE_TOKEN", "").strip()
    if not dash:
        out.append(
            Check(
                "env: DASHBOARD_URL",
                "WARN",
                "unset — automation rules will not fire from the pipeline",
            )
        )
    elif not dash.startswith("https://"):
        out.append(Check("env: DASHBOARD_URL", "FAIL", "must be https://"))
    elif len(token) < 32:
        out.append(
            Check(
                "env: HAWKEYE_PIPELINE_TOKEN",
                "FAIL",
                "set DASHBOARD_URL but token is missing/short (>= 32 chars)",
            )
        )
    else:
        out.append(Check("env: DASHBOARD_URL + token", "PASS", dash.split("//", 1)[1]))
    return out


def check_model() -> list[Check]:
    try:
        from intel import load_model_for_run

        m = load_model_for_run()
        kind = (
            "expert prior — retrain after ~20 verdicts"
            if m.version.startswith("prior")
            else f"trained on {m.trained_on}"
        )
        return [Check("model", "PASS", f"{m.version} ({kind})")]
    except Exception as exc:  # noqa: BLE001 — report, don't crash the checklist
        return [Check("model", "FAIL", f"cannot load: {exc}")]


def check_disk(path: Path = Path(".")) -> list[Check]:
    free_gb = shutil.disk_usage(path).free / 1e9
    status = "PASS" if free_gb >= MIN_FREE_GB else "WARN"
    return [Check("disk", status, f"{free_gb:.1f} GB free")]


def check_supabase() -> list[Check]:
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")):
        return [
            Check("supabase", "FAIL", "skipped — set SUPABASE_URL and the service role key first")
        ]
    try:
        from supabase import create_client

        db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    except Exception as exc:  # noqa: BLE001
        return [Check("supabase: client", "FAIL", str(exc))]
    out = []
    try:
        n = len(db.table("flights").select("id").limit(1).execute().data or [])
        out.append(
            Check(
                "supabase: flights table", "PASS", "reachable" + ("" if n else " (no flights yet)")
            )
        )
    except Exception as exc:  # noqa: BLE001
        out.append(Check("supabase: flights table", "FAIL", str(exc)[:120]))
    try:
        db.table("property_scans").select("factor_scores").limit(1).execute()
        out.append(Check("supabase: intel columns", "PASS", "factor_scores present"))
    except Exception:  # noqa: BLE001
        out.append(
            Check("supabase: intel columns", "FAIL", "apply 20260903040000_intel_scoring.sql")
        )
    try:
        buckets = {b.name for b in db.storage.list_buckets()}
        ok = "property-scans" in buckets
        out.append(
            Check(
                "supabase: storage bucket",
                "PASS" if ok else "FAIL",
                "property-scans" if ok else "bucket missing",
            )
        )
    except Exception as exc:  # noqa: BLE001
        out.append(Check("supabase: storage bucket", "FAIL", str(exc)[:120]))
    return out


def check_flight(flight_code: str, data_dir: Path, db_check: bool = True) -> list[Check]:
    out = []
    flight_dir = data_dir / flight_code
    if not flight_dir.is_dir():
        out.append(
            Check("crops staged", "FAIL", f"{flight_dir} not found — run crop_parcels.py first")
        )
    else:
        dirs = [p for p in flight_dir.iterdir() if p.is_dir()]
        paired = sum(
            1 for p in dirs if (p / "current.jpg").exists() and (p / "previous.jpg").exists()
        )
        status = "PASS" if paired else ("WARN" if dirs else "FAIL")
        out.append(
            Check("crops staged", status, f"{len(dirs)} parcels, {paired} with a previous week")
        )
    if db_check:
        try:
            from supabase import create_client

            db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
            rows = (
                db.table("flights").select("id").eq("flight_code", flight_code).execute().data or []
            )
            out.append(
                Check(
                    "flight row",
                    "PASS" if rows else "FAIL",
                    flight_code if rows else f"create {flight_code} on /flights first",
                )
            )
        except Exception as exc:  # noqa: BLE001
            out.append(Check("flight row", "FAIL", str(exc)[:120]))
    return out


def run(flight_code: str | None, data_dir: Path, offline: bool = False) -> list[Check]:
    checks: list[Check] = []
    steps: list[Callable[[], list[Check]]] = [
        lambda: check_dependencies(offline),
        check_env,
        check_model,
        check_disk,
    ]
    if not offline:
        steps.append(check_supabase)
    for step in steps:
        checks.extend(step())
    if flight_code:
        checks.extend(check_flight(flight_code, data_dir, db_check=not offline))
    return checks


def main() -> int:
    ap = argparse.ArgumentParser(description="HawkEye pre-flight readiness check")
    ap.add_argument("--flight-code", default=None)
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    ap.add_argument("--offline", action="store_true", help="skip every Supabase call")
    args = ap.parse_args()
    with contextlib.suppress(ImportError):  # reported by check_dependencies
        load_env()

    checks = run(args.flight_code, args.data_dir, offline=args.offline)
    for c in checks:
        print(c.line())
    fails = sum(1 for c in checks if c.status == "FAIL")
    warns = sum(1 for c in checks if c.status == "WARN")
    print(f"\n{'READY' if not fails else 'NOT READY'} — {fails} fail, {warns} warn")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
