"""Central configuration. Everything tunable lives here so judging runs can override via env vars."""
from __future__ import annotations
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env reader (no dependency). Real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        if v:
            os.environ.setdefault(k.strip(), v)


_load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("DEALPILOT_DATA", ROOT / "data" / "participant"))
CACHE_DB = Path(os.environ.get("DEALPILOT_CACHE", ROOT / "data" / "gemini_cache.sqlite"))

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
# Model chain: quotas are PER MODEL, so when one is exhausted the next is used. Order = preference.
GEMINI_MODELS = [m.strip() for m in os.environ.get(
    "GEMINI_MODELS", os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-2.5-flash")
).split(",") if m.strip()]
GEMINI_MODEL = GEMINI_MODELS[0]
GEMINI_RPM = int(os.environ.get("GEMINI_RPM", "30"))        # client-side rate limit
GEMINI_WORKERS = int(os.environ.get("GEMINI_WORKERS", "3"))
GEMINI_BATCH_DOCS = int(os.environ.get("GEMINI_BATCH_DOCS", "4"))   # documents per extraction request  # parallel extraction threads

TEAM_NAME = os.environ.get("DEALPILOT_TEAM", "DealPilot")

# A folder is considered "fully landed" when no new file arrived for this many minutes.
SETTLE_MINUTES = 15
# How long after the last required doc lands the (automated) Intake review completes.
INTAKE_PROCESSING_MINUTES = 3
# Stuck-deal thresholds, straight from rules/stages.json (user chose: spec only, no pre-warning).
ALERT_PCT, ESCALATE_PCT, SECOND_ESCALATE_PCT = 1.0, 1.5, 2.0

# Old-trick thresholds (rules/known_fraud_checks.md)
REV_INFLATION_RATIO = 1.5
BALANCE_TOLERANCE = 0.01  # dollars

# Cross-deal fraud graph
CLUSTER_MIN_SCORE = 8.0        # sum of ln(N/f) over shared rare attributes
CLUSTER_MIN_FAMILIES = 2       # independent attribute families required
GROUP_MIN_SCORE = 5.0           # a TIGHT GROUP (3+ deals, every pair linked on >=2 families) needs only this per pair
STRONG_ATTR_MIN_WEIGHT = 3.0   # a token counts only if rarer than ~1 in 20 deals (ln(N/f) >= 3)
