"""
catalogue.py — Pure-Python business logic for the Eyenetra voice agent.

All functions here are deterministic and have NO LLM involvement.
The same inputs always produce the same outputs.
Load once on import; call reload_catalogue() to refresh from disk.
"""

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Internal state
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).parent / "data"
_LEADS_FILE = Path(__file__).parent / "leads.json"

_frames: list[dict] = []
_lenses: list[dict] = []
_tryon_map: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Catalogue loading
# ---------------------------------------------------------------------------

def reload_catalogue() -> None:
    """Load (or reload) frames, lenses and the try-on map from CSV files."""
    global _frames, _lenses, _tryon_map

    frames_path = _DATA_DIR / "frames.csv"
    lenses_path = _DATA_DIR / "lenses.csv"
    tryon_path = _DATA_DIR / "tryon_map.csv"

    if not frames_path.exists():
        raise FileNotFoundError(f"frames.csv not found at {frames_path}")
    if not lenses_path.exists():
        raise FileNotFoundError(f"lenses.csv not found at {lenses_path}")

    with open(frames_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        row["price"] = int(row["price"])
        row["stock"] = int(row["stock"])
    _frames = rows

    with open(lenses_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        row["price"] = int(row["price"])
    _lenses = rows

    # Maps store SKUs to the try-on app's frame/variant ids (src/data/frames.ts).
    # Optional while the catalogue is placeholder data — a missing file just
    # means try_on_frame reports "not available on the try-on screen".
    _tryon_map = {}
    if tryon_path.exists():
        with open(tryon_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                _tryon_map[row["sku"].upper()] = {
                    "tryon_frame_id": row["tryon_frame_id"],
                    "tryon_variant_id": row["tryon_variant_id"],
                }


# ---------------------------------------------------------------------------
# Business logic functions (called by LLM tools)
# ---------------------------------------------------------------------------

def search_frames(
    max_price: int | None = None,
    shape: str | None = None,
    material: str | None = None,
    gender: str | None = None,
    frame_type: str | None = None,
    limit: int | None = 3,
) -> list[dict]:
    """
    Return up to `limit` (default 3; None = all) in-stock frames that match the given filters.
    All filters are optional; unset filters match everything.
    Results are sorted by price ascending.

    Args:
        max_price:  Maximum frame price in INR.
        shape:      Frame shape keyword (e.g. "round", "rectangular", "aviator").
        material:   Material keyword (e.g. "metal", "acetate", "titanium", "TR90").
        gender:     "male", "female", or "unisex".
        frame_type: "frame" (eyeglasses) or "sunglass".

    Returns:
        List of matching frame dicts (may be empty if no match).
    """
    results = []
    for frame in _frames:
        if frame["stock"] == 0:
            continue
        if max_price is not None and frame["price"] > max_price:
            continue
        if shape and shape.lower() not in frame["shape"].lower():
            continue
        if material and material.lower() not in frame["material"].lower():
            continue
        if gender and gender.lower() not in ("unisex", frame["gender"].lower()):
            # "unisex" frames match any gender filter
            if frame["gender"].lower() != "unisex" and gender.lower() != frame["gender"].lower():
                continue
        if frame_type and frame_type.lower() not in frame["type"].lower():
            continue
        results.append(frame)

    results.sort(key=lambda x: x["price"])
    return results if limit is None else results[:limit]


def recommend_lens(
    screen_time_hours: int,
    has_power: bool,
    age: int,
) -> dict:
    """
    Return the most appropriate lens type based on optometrist rules.
    This is a pure if/else decision tree — NOT an LLM call.

    Rules (derived from Eyenetra optometrist — update after store visit):
        - has_power + age >= 40              → Progressive (near + distance)
        - has_power + screen_time >= 6 hrs   → Blue-Cut Anti-Reflective
        - has_power + screen_time < 6 hrs    → Standard Anti-Reflective
        - no power + screen_time >= 6 hrs    → Blue-Cut Zero Power
        - no power + screen_time < 6 hrs     → Standard Single Vision
    """
    if has_power and age >= 40:
        target = "PROG-01"
    elif has_power and screen_time_hours >= 6:
        target = "BLU-AR-01"
    elif has_power:
        target = "AR-01"
    elif screen_time_hours >= 6:
        target = "BLU-ZERO-01"
    else:
        target = "STD-SV-01"

    for lens in _lenses:
        if lens["lens_code"] == target:
            return lens

    # Fallback — should not reach here with a complete lenses.csv
    return _lenses[0] if _lenses else {"error": "Lens catalogue is empty"}


def check_stock(sku: str) -> bool:
    """Return True if the given frame SKU is in stock."""
    for frame in _frames:
        if frame["sku"].upper() == sku.upper():
            return frame["stock"] > 0
    return False


def get_frame_details(sku: str) -> dict | None:
    """
    Return full details for a frame SKU, or None if not found.
    Always call this before quoting any price — never state a price from memory.
    """
    for frame in _frames:
        if frame["sku"].upper() == sku.upper():
            return frame
    return None


def resolve_tryon(sku: str) -> dict | None:
    """
    Return the try-on app target {"tryon_frame_id", "tryon_variant_id"} for a
    store SKU, or None if the SKU has no mapped 3D model yet.
    """
    return _tryon_map.get(sku.upper())


def create_lead(
    name: str,
    phone: str,
    interest_summary: str,
    recommended_frames: list[str] | None = None,
    recommended_lens: str | None = None,
    budget: str | None = None,
    screen_time: str | None = None,
) -> dict:
    """
    Save a qualified customer lead to leads.json.
    Call only when the customer has explicitly agreed to speak with an executive.

    Returns the saved lead dict.
    """
    lead = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "name": name,
        "phone": phone,
        "interest_summary": interest_summary,
        "recommended_frames": recommended_frames or [],
        "recommended_lens": recommended_lens,
        "budget": budget,
        "screen_time": screen_time,
    }

    # Load existing leads (create file if missing)
    existing: list[dict] = []
    if _LEADS_FILE.exists():
        try:
            with open(_LEADS_FILE, encoding="utf-8") as f:
                existing = json.load(f)
        except json.JSONDecodeError:
            existing = []

    existing.append(lead)

    with open(_LEADS_FILE, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)

    print(f"  [LEAD SAVED] {name} -- {interest_summary}")
    return lead


# ---------------------------------------------------------------------------
# Load on import
# ---------------------------------------------------------------------------
reload_catalogue()


# Words the shop always says, beyond the catalogue's own brands and names.
_STYLE_TERMS = [
    "aviator", "round", "square", "rectangular", "cat-eye", "oval", "wayfarer",
    "titanium", "metal", "acetate", "TR90", "frame", "sunglasses", "lens",
    "anti-glare", "blue cut", "progressive", "bifocal", "photochromic",
    "executive", "repair", "budget",
]


def stt_keyterms(limit: int = 50) -> list[str]:
    """Recognition hints for Sarvam STT (saaras:v4 `keyterms`: ≤50 terms of
    ≤64 chars). Brands first, then style words, then frame names — so the
    words that decide a search survive the cap as the catalogue grows."""
    seen: dict[str, None] = {}
    for term in (
        [f["brand"] for f in _frames]
        + _STYLE_TERMS
        + [f["name"] for f in _frames]
        + [l["name"] for l in _lenses]
    ):
        t = term.strip()[:64]
        if t and t.lower() not in {k.lower() for k in seen}:
            seen[t] = None
    return list(seen)[:limit]
