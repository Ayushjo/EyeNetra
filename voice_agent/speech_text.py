"""
speech_text.py — make what the bot SAYS identical every time.

Sarvam's TTS guidance (docs.sarvam.ai, text-to-speech best practices):
write Hindi in Devanagari (romanised Hindi "significantly degrades output
quality"), keep brand names in English script. bulbul:v3 has no seed, so the
same text can still vary slightly — but the same text is the precondition.

This module is the single source of spoken numbers: prices and counts are
converted here, in Python, to Devanagari number words — never left to the
LLM or to the TTS engine's own normalisation (live: prices were read in
English words on some turns and Hindi on others).
"""

import re

from pipecat.utils.text.base_text_filter import BaseTextFilter

# 0–99 are irregular in Hindi, so they are a table, not a rule.
_UNITS = (
    "शून्य एक दो तीन चार पाँच छह सात आठ नौ "
    "दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस "
    "बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस "
    "तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस "
    "चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास "
    "पचास इक्यावन बावन तिरेपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ "
    "साठ इकसठ बासठ तिरेसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर "
    "सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी "
    "अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी "
    "नब्बे इक्यानवे बानवे तिरानवे चौरानवे पंचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे"
).split()
assert len(_UNITS) == 100


def hindi_number(n: int) -> str:
    """Integer → Devanagari words in the Indian system (सौ, हज़ार, लाख, करोड़).

    Shop convention for round prices 1100–1900: "पंद्रह सौ", not
    "एक हज़ार पाँच सौ" — applied consistently so the same price is always
    spoken the same way.
    """
    if n < 0:
        return "माइनस " + hindi_number(-n)
    if n < 100:
        return _UNITS[n]
    if 1100 <= n < 2000 and n % 100 == 0:
        return f"{_UNITS[n // 100]} सौ"
    parts = []
    for size, word in ((10_000_000, "करोड़"), (100_000, "लाख"), (1000, "हज़ार"), (100, "सौ")):
        if n >= size:
            parts.append(f"{hindi_number(n // size)} {word}")
            n %= size
    if n:
        parts.append(_UNITS[n])
    return " ".join(parts)


def rupees(price: int) -> str:
    """Spoken price, e.g. 2499 → "दो हज़ार चार सौ निन्यानवे रुपये"."""
    return f"{hindi_number(int(price))} रुपये"


# ₹ / Rs amounts first (so the currency word is not doubled), then bare numbers.
_CURRENCY_RE = re.compile(r"(?:₹|\bRs\.?|\bINR)\s*([\d,]+)(?:\s*(?:रुपये|रुपए|rupaye|rupees))?", re.IGNORECASE)
_NUMBER_RE = re.compile(r"(?<![\w-])(\d{1,3}(?:,\d{2,3})+|\d+)(?![\w-])")
# SKU codes like EN-1041 must never be read out (system prompt rule).
_SKU_RE = re.compile(r"\b[A-Z]{2,4}-\d{3,5}\b")


def _to_int(digits: str) -> int:
    return int(digits.replace(",", ""))


def normalise_for_speech(text: str, strip: bool = True) -> str:
    """Digits → Devanagari words, currency symbols → रुपये, SKUs dropped.

    strip=False for streamed TTS chunks, whose edge spaces separate words.
    """
    text = _SKU_RE.sub("", text)
    text = _CURRENCY_RE.sub(lambda m: rupees(_to_int(m.group(1))), text)
    text = _NUMBER_RE.sub(lambda m: hindi_number(_to_int(m.group(1))), text)
    text = text.replace("₹", "")
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip() if strip else text


class HindiSpeechFilter(BaseTextFilter):
    """Pipecat TTS text filter applying normalise_for_speech to every chunk."""

    async def filter(self, text: str) -> str:
        return normalise_for_speech(text, strip=False)

    async def handle_interruption(self):
        pass

    async def reset_interruption(self):
        pass
