"""
normalise.py — Convert Hindi/English number expressions to integers.

Handles:
  "chaar hazaar"          → 4000
  "do hazaar paanch sau"  → 2500
  "teen lakh"             → 300000
  "3k" / "3K"             → 3000
  "₹4,000"                → 4000
  "1500"                  → 1500
  "paanch"                → 5
  "bees"                  → 20

Algorithm:
  Tokens are processed left to right.
  Unit words (ek, do, …) add to `current`.
  Multiplier words (sau, hazaar, lakh) consume `current`, multiply, and add to `total`,
  then reset `current` to 0. This correctly handles "do hazaar paanch sau" = 2500.
"""

import re

# ---------------------------------------------------------------------------
# Word → value tables
# ---------------------------------------------------------------------------

_UNIT_WORDS: dict[str, int] = {
    # Romanised Hindi has no fixed spelling — customers and speech-to-text both
    # produce vowel-length variants ("aath" / "aaath", "char" / "chaar").
    # Every plausible variant must be listed: an unrecognised token is silently
    # ignored, which turns "aaath ghante" into 0 hours and produces the WRONG
    # lens recommendation. Add variants here whenever you see one in the wild.
    "ek": 1,
    "eak": 1,
    "do": 2,
    "teen": 3,
    "tin": 3,
    "chaar": 4,
    "char": 4,
    "chaar": 4,
    "paanch": 5,
    "panch": 5,
    "pach": 5,
    "che": 6,
    "chhe": 6,
    "chah": 6,
    "chhah": 6,
    "saat": 7,
    "sat": 7,
    "aath": 8,
    "aaath": 8,
    "ath": 8,
    "aatth": 8,
    "nau": 9,
    "no": 9,
    "das": 10,
    "dus": 10,
    "dass": 10,
    "gyarah": 11,
    "barah": 12,
    "terah": 13,
    "chaudah": 14,
    "pandrah": 15,
    "solah": 16,
    "satrah": 17,
    "attharah": 18,
    "unnis": 19,
    "bees": 20,
    "bis": 20,
    "ekees": 21,
    "baees": 22,
    "teis": 23,
    "chauees": 24,
    "pachchees": 25,
    "chabbees": 26,
    "sattaees": 27,
    "atthaees": 28,
    "untees": 29,
    "tees": 30,
    "tis": 30,
    "ikattees": 31,
    "battees": 32,
    "taintees": 33,
    "chautees": 34,
    "paintees": 35,
    "chhattees": 36,
    "saintees": 37,
    "athtees": 38,
    "untaalees": 39,
    "chaalees": 40,
    "chaalis": 40,
    "chalis": 40,
    "pachaas": 50,
    "pachas": 50,
    "pachpan": 55,
    # NOTE: "saath" (60) collides with the common Hindi word for "with/together".
    # Safe here because this parser only ever sees budget / screen-time phrases,
    # never free conversation. Do not call it on whole utterances.
    "saath": 60,
    "sattar": 70,
    "assi": 80,
    "nabbe": 90,
}

_MULTIPLIER_WORDS: dict[str, int] = {
    "sau": 100,
    "hazaar": 1_000,
    "hazar": 1_000,      # alternate spelling
    "lakh": 100_000,
    "lac": 100_000,
    "crore": 10_000_000,
    "karod": 10_000_000,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def normalize_hindi_number(text: str) -> int | None:
    """
    Parse a Hindi/English number phrase and return an integer, or None if not parseable.

    Examples:
        >>> normalize_hindi_number("chaar hazaar")
        4000
        >>> normalize_hindi_number("do hazaar paanch sau")
        2500
        >>> normalize_hindi_number("3k")
        3000
        >>> normalize_hindi_number("₹4,000")
        4000
        >>> normalize_hindi_number("haan")
        None
    """
    if not text or not text.strip():
        return None

    cleaned = text.strip().lower()

    # Strip currency symbol and commas
    cleaned = cleaned.replace("₹", "").replace(",", "").strip()

    # ── "3k" / "3.5k" ──────────────────────────────────────────────────────
    k_match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*k", cleaned)
    if k_match:
        return int(float(k_match.group(1)) * 1_000)

    # ── Plain digits (possibly with decimal) ────────────────────────────────
    digit_match = re.fullmatch(r"\d+(?:\.\d+)?", cleaned)
    if digit_match:
        return int(float(cleaned))

    # ── Hindi word parsing ───────────────────────────────────────────────────
    tokens = cleaned.split()
    if not tokens:
        return None

    total = 0
    current = 0

    for token in tokens:
        if token in _UNIT_WORDS:
            current += _UNIT_WORDS[token]

        elif re.fullmatch(r"\d+", token):
            # Mixed input like "3 hazaar"
            current += int(token)

        elif token in _MULTIPLIER_WORDS:
            mult = _MULTIPLIER_WORDS[token]
            if current == 0:
                current = 1          # "hazaar" alone → 1000
            total += current * mult
            current = 0

        # Ignore unrecognised tokens (prepositions, filler words, etc.)

    total += current
    return total if total > 0 else None


def _largest_multiplier(phrase: str) -> int | None:
    """Return the largest multiplier word present in a phrase, or None."""
    found = [
        _MULTIPLIER_WORDS[tok]
        for tok in phrase.split()
        if tok in _MULTIPLIER_WORDS
    ]
    return max(found) if found else None


def extract_budget(text: str) -> tuple[int | None, int | None]:
    """
    Try to extract a budget range from a freeform phrase.
    Returns (min_budget, max_budget). Either may be None.

    Examples:
        "do se teen hazaar"  → (2000, 3000)
        "under 4000"         → (None, 4000)
        "around 3k"          → (None, 3000)
        "chaar hazaar"       → (None, 4000)
    """
    text_lower = text.lower().replace("₹", "").replace(",", "")

    # "X se Y" or "X to Y" range
    range_pattern = re.search(
        r"(\w[\w\s]*?)\s+(?:se|to|–|-)\s+([\w\s]+?)(?:\s+(?:ke andar|tak|mein|around|approx))?$",
        text_lower,
    )
    if range_pattern:
        lo_phrase = range_pattern.group(1).strip()
        hi_phrase = range_pattern.group(2).strip()
        lo = normalize_hindi_number(lo_phrase)
        hi = normalize_hindi_number(hi_phrase)

        # "do se teen hazaar" — the multiplier sits only on the upper bound but
        # applies to both sides. Inherit it when the lower bound has none of its
        # own and the result is still below the upper bound.
        if lo is not None and hi is not None:
            if _largest_multiplier(lo_phrase) is None:
                hi_mult = _largest_multiplier(hi_phrase)
                if hi_mult and lo * hi_mult <= hi:
                    lo = lo * hi_mult

        if lo or hi:
            return lo, hi

    # "under X" / "below X" / "X ke andar" / "max X"
    under_pattern = re.search(
        r"(?:under|below|max(?:imum)?|ke andar|tak)\s+([\w\s,₹]+?)(?:\s|$)",
        text_lower,
    )
    if under_pattern:
        val = normalize_hindi_number(under_pattern.group(1).strip())
        if val:
            return None, val

    # "around X" / "approximately X" / "lagbhag X"
    around_pattern = re.search(
        r"(?:around|approximately|lagbhag|about)\s+([\w\s,₹]+?)(?:\s|$)",
        text_lower,
    )
    if around_pattern:
        val = normalize_hindi_number(around_pattern.group(1).strip())
        if val:
            return None, val

    # Bare number / phrase
    val = normalize_hindi_number(text_lower.strip())
    if val:
        return None, val

    return None, None
