"""
test_fast_intent.py — the LLM shortcut must never take a wrong action.

Run with:  .venv/bin/python test_fast_intent.py
Also replays every cached STT transcript of the eval set (eval_cache,
including crowded-shop 0 dB babble) and counts wrong actions.
"""

import json
from pathlib import Path

from fast_intent import fast_intent

SHOW = {"next_frame", "like_frame", "set_preferences", "finish", "notify_staff", "recommend_lens"}
LIKED = {"wants_executive", "next_frame", "finish", "notify_staff", "recommend_lens"}
results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


cases = [
    (SHOW, "अगला दिखाओ।", "next_frame"),
    (SHOW, "दूसरा दिखाइए", "next_frame"),
    (SHOW, "नहीं ये पसंद नहीं आया, दूसरा दिखाइए।", "next_frame"),
    (SHOW, "next please", "next_frame"),
    (SHOW, "ये वाला अच्छा लग रहा है, यही लेंगे।", "like_frame"),
    (SHOW, "हाँ, ये वाला अच्छा है, यही लूँगा।", "like_frame"),
    (SHOW, "पसंद आया", "like_frame"),
    (SHOW, "पसंद नहीं आया", None),            # negated like without "next" → LLM decides
    (SHOW, "इसकी कीमत कितनी है?", None),       # question → LLM
    (SHOW, "क्या अगला वाला सस्ता है?", None),   # question → LLM
    (SHOW, "rectangular में कुछ है क्या?", None),
    (SHOW, "बस रहने दीजिए, बाद में आऊँगा।", None),
    (SHOW, "अच्छा है पर अगला भी दिखाओ", None),  # mixed → LLM
    (LIKED, "हाँ, executive से बात करवा दीजिए।", "wants_executive"),
    (LIKED, "हाँ जी", "wants_executive"),
    (LIKED, "नहीं, अभी नहीं", None),
    (LIKED, "हाँ पर पहले अगला दिखाओ", None),     # "हाँ" + next: not a clean yes … see below
    ({"record_need"}, "अगला दिखाओ", None),     # node without those functions
]
for avail, text, want in cases:
    got = fast_intent(text, avail)
    if text == "हाँ पर पहले अगला दिखाओ":
        # Acceptable outcomes: LLM (None) or next_frame — never wants_executive.
        check(f"{text!r} → not wants_executive (got {got})", got != "wants_executive")
        continue
    check(f"{text!r} → {want} (got {got})", got == want)

# Replay the eval set's STT transcripts (incl. crowded shop): count wrong actions.
cache = Path(__file__).parent / "eval_cache" / "stt_results.json"
if cache.exists():
    import eval_accuracy as E

    by_id = {t["id"]: t for t in E.TESTS}
    stt = json.loads(cache.read_text())
    fired = wrong = 0
    for key, text in stt.items():
        _cfg, tid, _v, _cond = key.split("|")
        t = by_id[tid]
        avail = {"show": SHOW, "liked": LIKED}.get(t["node"])
        if not avail:
            continue
        got = fast_intent(text, avail)
        if got:
            fired += 1
            if got != t["expect"][0]:
                wrong += 1
                print(f"  WRONG {tid}: {text!r} → {got}")
    print(f"\nreplayed eval transcripts: shortcut fired {fired}×, wrong {wrong}×")
    check("no wrong shortcut actions on eval transcripts (incl. 0 dB babble)", wrong == 0)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
raise SystemExit(1 if failed else 0)
