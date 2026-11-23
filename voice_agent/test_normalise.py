"""
test_normalise.py — Unit tests for the Hindi/English number normaliser.

Run with:
    python test_normalise.py

All 35 cases should PASS. If any fail, fix normalise.py before moving on.
"""

from normalise import normalize_hindi_number, extract_budget

# ---------------------------------------------------------------------------
# Test cases: (input, expected_output)
# ---------------------------------------------------------------------------

NORMALISE_CASES: list[tuple[str, int | None]] = [
    # ── Pure digits ──────────────────────────────────────────────────────────
    ("4000", 4_000),
    ("1500", 1_500),
    ("800", 800),
    ("12000", 12_000),

    # ── Digit with comma / currency symbol ──────────────────────────────────
    ("₹4,000", 4_000),
    ("₹1,200", 1_200),
    ("4,500", 4_500),

    # ── k-suffix ────────────────────────────────────────────────────────────
    ("3k", 3_000),
    ("3K", 3_000),
    ("4.5k", 4_500),
    ("10k", 10_000),
    ("1.5k", 1_500),

    # ── Single Hindi unit words ──────────────────────────────────────────────
    ("paanch", 5),
    ("das", 10),
    ("bees", 20),
    ("tees", 30),
    ("chaalees", 40),
    ("nabbe", 90),

    # ── Hundreds ────────────────────────────────────────────────────────────
    ("paanch sau", 500),
    ("do sau", 200),
    ("ek sau", 100),
    ("teen sau", 300),

    # ── Thousands ───────────────────────────────────────────────────────────
    ("ek hazaar", 1_000),
    ("do hazaar", 2_000),
    ("chaar hazaar", 4_000),
    ("paanch hazaar", 5_000),
    ("das hazaar", 10_000),

    # ── Thousands + hundreds ─────────────────────────────────────────────────
    ("do hazaar paanch sau", 2_500),
    ("teen hazaar paanch sau", 3_500),
    ("chaar hazaar aath sau", 4_800),

    # ── Mixed digit + Hindi word ─────────────────────────────────────────────
    ("3 hazaar", 3_000),
    ("5 sau", 500),

    # ── Lakh ────────────────────────────────────────────────────────────────
    ("ek lakh", 100_000),
    ("do lakh", 200_000),
    ("teen lakh paanch hazaar", 305_000),

    # ── Should return None ───────────────────────────────────────────────────
    ("haan", None),
    ("", None),
    ("thoda", None),
]


BUDGET_CASES: list[tuple[str, tuple[int | None, int | None]]] = [
    ("do se teen hazaar", (2_000, 3_000)),
    ("under 4000", (None, 4_000)),
    ("chaar hazaar ke andar", (None, 4_000)),
    ("around 3k", (None, 3_000)),
    ("chaar hazaar", (None, 4_000)),
    ("2000 to 4000", (2_000, 4_000)),
]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_tests() -> None:
    passed = 0
    failed = 0

    print("-" * 56)
    print("  normalize_hindi_number() -- 35 cases")
    print("-" * 56)

    for text, expected in NORMALISE_CASES:
        got = normalize_hindi_number(text)
        ok = got == expected
        status = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
            print(f"  {status}  '{text}'  →  got {got!r},  expected {expected!r}")

    if failed == 0:
        print(f"  All {passed} cases PASSED [OK]")
    else:
        print(f"\n  {passed} passed, {failed} FAILED [FAIL]")

    print()
    print("-" * 56)
    print("  extract_budget() -- 6 cases")
    print("-" * 56)

    b_passed = 0
    b_failed = 0
    for text, expected in BUDGET_CASES:
        got = extract_budget(text)
        ok = got == expected
        status = "PASS" if ok else "FAIL"
        if ok:
            b_passed += 1
        else:
            b_failed += 1
            print(f"  {status}  '{text}'  →  got {got!r},  expected {expected!r}")

    if b_failed == 0:
        print(f"  All {b_passed} cases PASSED [OK]")
    else:
        print(f"\n  {b_passed} passed, {b_failed} FAILED [FAIL]")

    print()
    total_fail = failed + b_failed
    if total_fail == 0:
        print("[ALL PASS] All tests passed -- normalise.py is ready.")
    else:
        print(f"[FAIL] {total_fail} test(s) failed -- fix normalise.py before continuing.")


if __name__ == "__main__":
    run_tests()
