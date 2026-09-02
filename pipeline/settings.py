"""
Environment handling for the pipeline CLIs.

Every entry point that talks to Supabase or the dashboard goes through these
helpers so a missing or malformed variable fails with one readable line
instead of a KeyError traceback — and so no secret value is ever echoed.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger("hawkeye")

ENV_FILE = Path(__file__).with_name(".env")


def load_env() -> None:
    """Load pipeline/.env (if present) without overriding variables already set."""
    from dotenv import load_dotenv

    load_dotenv(ENV_FILE, override=False)


def require_env(name: str) -> str:
    """Return the variable's value or exit with a copy-the-example hint."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is not set; copy .env.example to .env and fill it in")
    return value


def require_https(name: str, value: str) -> str:
    """Refuse plaintext endpoints for anything that carries a token or a lead."""
    if not value.lower().startswith("https://"):
        raise SystemExit(f"{name} must be an https:// URL (refusing to send over plaintext)")
    return value.rstrip("/")


def configure_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
