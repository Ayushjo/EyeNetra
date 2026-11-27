"""
fast_intent.py — answer the obvious turns without waiting for the LLM.

Measured end to end (e2e_customer.py, 17 Nov): Gemini 2.5 Flash takes
1.0–1.4 s per turn even when all it does is pick "next_frame" for
"अगला दिखाओ". Most turns in the try-on loop are exactly that: next / like /
yes-to-executive. Here they are matched deterministically, gated by the
functions the current flow node actually offers, and anything that is not
an unambiguous match (questions, negations, mixed intents) still goes to the
LLM. Precision over recall: a miss costs one second, a wrong action costs
the customer.
"""

import re
import unicodedata

_NEG = re.compile(r"नहीं|नही|ना\b|मत\b|\bnahi|\bnahin|\bno\b|\bnot\b|dont|don't", re.I)
_QUESTION = re.compile(r"\?|क्या|कितन|कौन|कैसे|क्यों|\bkya\b|\bkitn|\bkaun|\bkaise|\bkyon?\b|\bhow\b|\bwhat\b|\bwhich\b", re.I)

_NEXT = re.compile(
    r"अगला|अगली|अगले|दूसरा|दूसरी|दूसरे|और\s*(?:कोई|दिखा)|कोई\s*और|\bnext\b|\bagla\b|\bagli\b|\bdusra\b|\bdoosra\b|\baur\s*dikha|\bkoi\s*aur\b",
    re.I,
)
_LIKE = re.compile(
    r"पसंद\s*(?:है|आया|आ\s*गया|हैं)|अच्छा\s*(?:है|लग)|अच्छी\s*(?:है|लग)|बढ़िया\s*है|\bpasand\s*(?:hai|aaya|aya)\b|\b(?:accha|achha|acha)\s*(?:hai|lag)\b|\bi\s*like\b",
    re.I,
)
# "I'll take this one" — a decision, not just a like.
_FINAL = re.compile(
    r"यही\s*(?:लूँगा|लूंगा|लेंगे|लूँगी|लूंगी|चाहिए|फ़ाइनल|फाइनल)|ये\s*(?:वाला\s*)?(?:लूँगा|लूंगा|लेंगे|ले\s*लेंगे|ले\s*लूँगा|फ़ाइनल|फाइनल)|इसे\s*(?:फ़ाइनल|फाइनल)|फ़ाइनल\s*(?:कर|है)|फाइनल\s*(?:कर|है)|\byahi\s*(?:lunga|lenge|chahiye)\b|\bfinal\b",
    re.I,
)
_YES = re.compile(r"^(?:हाँ|हां|हा|जी\s*हाँ|जी\s*हां|हाँ\s*जी|हां\s*जी|ज़रूर|जरूर|ठीक\s*है|बिल्कुल|ओके|yes|haan|han|ji|ok|okay|sure|zaroor)(?=[\s।,.!]|$)", re.I)
# (\b fails after Devanagari vowel signs like "ँ": they are not \w characters.)
_EXEC = re.compile(r"बात\s*करवा|बात\s*करा|बुला|executive|एग्ज़?ीक्यूटिव|एक्ज़?ीक्यूटिव|baat\s*kar", re.I)


def _norm(text: str) -> str:
    return unicodedata.normalize("NFC", text).strip().lower()


def fast_intent(text: str, available: set[str]) -> str | None:
    """Function to call for an unambiguous customer reply, else None."""
    t = _norm(text)
    if not t or len(t.split()) > 12:
        return None
    neg = bool(_NEG.search(t))
    question = bool(_QUESTION.search(t))

    contrast = bool(re.search(r"\sपर\s|लेकिन|मगर|\bbut\b|\bpar\b|\blekin\b", t))
    if neg or question or contrast:
        # "पसंद नहीं, दूसरा दिखाइए" → next (negated like + next) is the one safe negation.
        if neg and not question and "next_frame" in available and _NEXT.search(t) and not _FINAL.search(t):
            return "next_frame"
        return None

    if "choose_frame" in available and _FINAL.search(t) and not _NEXT.search(t):
        return "choose_frame"
    if "like_frame" in available and "next_frame" in available:
        like, nxt = bool(_LIKE.search(t)), bool(_NEXT.search(t))
        if nxt and not like:
            return "next_frame"
        if like and not nxt:
            return "like_frame"
    return None


# ---------------------------------------------------------------------------
# Lifestyle answers with a clear number of screen hours: record them directly.
# The LLM sometimes asks a follow-up ("और धूप में?") instead of recording a
# partial answer (sim_conversations.py, 2/100) — this makes it deterministic.
# ---------------------------------------------------------------------------
_NUM_WORDS = {
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8,
    "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12, "चौदह": 14, "पंद्रह": 15,
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "twelve": 12, "ek": 1, "do": 2, "teen": 3, "char": 4, "paanch": 5, "panch": 5, "chhe": 6,
    "saat": 7, "aath": 8, "nau": 9, "das": 10, "barah": 12,
}
_NUM = r"(\d{1,2}|" + "|".join(sorted(map(re.escape, _NUM_WORDS), key=len, reverse=True)) + r")"
_HOURS = re.compile(_NUM + r"(?:\s*[-–से]+\s*" + _NUM + r")?\s*(?:घंटे|घंटा|घण्टे|hours?|hrs?|ghante|ghanta)", re.I)
_SCREEN = re.compile(r"laptop|लैपटॉप|computer|कंप्यूटर|कम्प्यूटर|mobile|मोबाइल|फ़ोन|फोन|phone|screen|स्क्रीन|टीवी|\btv\b|office|ऑफ़िस|काम", re.I)
_DRIVE = re.compile(r"गाड़ी|गाडी|ड्राइव|ड्राइविंग|drive|driving|bike|बाइक|gaadi|gadi|car\b", re.I)
_SUN = re.compile(r"धूप|dhoop|बाहर\s*(?:ज़्यादा|रहता|काम)|outdoor|field", re.I)


def _num(tok: str | None) -> int | None:
    if not tok:
        return None
    return int(tok) if tok.isdigit() else _NUM_WORDS.get(tok.lower())


def fast_call(text: str, available: set[str]) -> tuple[str, dict] | None:
    """(function, args) for an unambiguous reply, else None. Superset of fast_intent."""
    name = fast_intent(text, available)
    if name:
        return name, {}
    if "record_lifestyle" not in available:
        return None
    t = _norm(text)
    if _QUESTION.search(t) or len(t.split()) > 16:
        return None
    m = _HOURS.search(t)
    if not m or not _SCREEN.search(t):
        return None
    lo, hi = _num(m.group(1)), _num(m.group(2))
    if lo is None:
        return None
    args: dict = {"screen_hours": hi if hi and hi > lo else lo}
    if _DRIVE.search(t) and not _NEG.search(t):
        args["driving"] = True
    if _SUN.search(t) and not _NEG.search(t):
        args["outdoor"] = True
    return "record_lifestyle", args
