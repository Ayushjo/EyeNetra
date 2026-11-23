"""
test_tools.py — Offline tests for the tool-argument coercion layer.

No API key needed. No LLM calls. Pure Python.

This guards the boundary between the LLM and the catalogue: the model is told to
pass integers, but in practice it passes phrases like "chaar hazaar", "7-8 hours",
or "under 3k". Every one of those must land on the catalogue as a real int, because
a mis-parsed screen time silently changes which lens the customer is sold.

Run with:
    python test_tools.py
"""

import sys

from tools import _normalise_args, _coerce_int, _coerce_bool
from catalogue import recommend_lens


# ---------------------------------------------------------------------------
# Cases: (tool_name, raw_args_from_llm, expected_normalised_args)
# ---------------------------------------------------------------------------

COERCION_CASES = [
    # --- search_frames: budget phrases -------------------------------------
    ("search_frames", {"max_price": 4000}, {"max_price": 4000}),
    ("search_frames", {"max_price": "4000"}, {"max_price": 4000}),
    ("search_frames", {"max_price": "chaar hazaar"}, {"max_price": 4000}),
    ("search_frames", {"max_price": "₹4,000"}, {"max_price": 4000}),
    ("search_frames", {"max_price": "3k"}, {"max_price": 3000}),
    ("search_frames", {"max_price": "under 3000"}, {"max_price": 3000}),
    ("search_frames", {"max_price": "do se teen hazaar"}, {"max_price": 3000}),
    ("search_frames", {"max_price": "paanch sau"}, {"max_price": 500}),
    # Unparseable budget → drop the filter rather than guess a number
    ("search_frames", {"max_price": "reasonable"}, {}),
    # Hallucinated kwarg must be dropped, not passed through as TypeError
    ("search_frames", {"max_price": 2000, "colour": "blue"}, {"max_price": 2000}),
    ("search_frames", {"shape": "round", "material": "acetate"},
     {"shape": "round", "material": "acetate"}),

    # --- recommend_lens: screen time, power, age ---------------------------
    ("recommend_lens", {"screen_time_hours": 8, "has_power": True, "age": 30},
     {"screen_time_hours": 8, "has_power": True, "age": 30}),
    # The bug that shipped: "aaath" was not in the word table → 0 hours → wrong lens
    ("recommend_lens", {"screen_time_hours": "aaath ghante", "has_power": "haan",
                        "age": "tees saal"},
     {"screen_time_hours": 8, "has_power": True, "age": 30}),
    ("recommend_lens", {"screen_time_hours": "7-8 hours", "has_power": True, "age": 32},
     {"screen_time_hours": 8, "has_power": True, "age": 32}),
    ("recommend_lens", {"screen_time_hours": "das", "has_power": "yes", "age": "chaalees"},
     {"screen_time_hours": 10, "has_power": True, "age": 40}),
    ("recommend_lens", {"screen_time_hours": 4, "has_power": "nahi", "age": 25},
     {"screen_time_hours": 4, "has_power": False, "age": 25}),
    # Vague answers fall back to documented defaults (and print a WARN)
    ("recommend_lens", {"screen_time_hours": "bahut zyaada", "has_power": True,
                        "age": "youngster"},
     {"screen_time_hours": 0, "has_power": True, "age": 30}),

    # --- create_lead -------------------------------------------------------
    ("create_lead", {"name": "Priya", "phone": "9876543210",
                     "interest_summary": "blue-cut", "recommended_frames": "EN-1001"},
     {"name": "Priya", "phone": "9876543210",
      "interest_summary": "blue-cut", "recommended_frames": ["EN-1001"]}),
]


# ---------------------------------------------------------------------------
# End-to-end lens decision table — the money path
# ---------------------------------------------------------------------------
# (screen_time, has_power, age) → expected lens_code
LENS_CASES = [
    (8, True, 45, "PROG-01"),      # power + 40+ → progressive wins
    (2, True, 52, "PROG-01"),
    (8, True, 30, "BLU-AR-01"),    # power + heavy screen
    (6, True, 30, "BLU-AR-01"),    # boundary: exactly 6 hrs
    (5, True, 30, "AR-01"),        # power + light screen
    (9, False, 25, "BLU-ZERO-01"), # no power + heavy screen
    (3, False, 25, "STD-SV-01"),   # no power + light screen
    (0, False, 30, "STD-SV-01"),
]


def run_tests() -> int:
    passed = failed = 0

    print("-" * 60)
    print(f"  _normalise_args() -- {len(COERCION_CASES)} cases")
    print("-" * 60)

    for tool, raw, expected in COERCION_CASES:
        got = _normalise_args(tool, raw)
        if got == expected:
            passed += 1
        else:
            failed += 1
            print(f"  FAIL  {tool}{raw}")
            print(f"        got      {got!r}")
            print(f"        expected {expected!r}")

    print(f"  {passed} passed, {failed} failed")

    print()
    print("-" * 60)
    print(f"  recommend_lens() decision table -- {len(LENS_CASES)} cases")
    print("-" * 60)

    l_passed = l_failed = 0
    for screen, power, age, expected_code in LENS_CASES:
        got = recommend_lens(screen_time_hours=screen, has_power=power, age=age)
        code = got.get("lens_code")
        if code == expected_code:
            l_passed += 1
        else:
            l_failed += 1
            print(f"  FAIL  screen={screen} power={power} age={age}")
            print(f"        got {code!r}, expected {expected_code!r}")

    print(f"  {l_passed} passed, {l_failed} failed")

    total_failed = failed + l_failed
    print()
    if total_failed == 0:
        print("[ALL PASS] Tool coercion layer is sound.")
    else:
        print(f"[FAIL] {total_failed} test(s) failed.")
    return total_failed


if __name__ == "__main__":
    sys.exit(1 if run_tests() else 0)
