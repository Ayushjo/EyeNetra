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
