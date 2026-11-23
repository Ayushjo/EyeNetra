"""
turn_completion.py — don't cut the customer off mid-sentence.

The turn ends when Sarvam's VAD hears a pause. Indian customers often pause
to think mid-sentence ("मेरा बजट है लगभग… दो हज़ार"), and the bot then
answers half a sentence. Smart Turn v3 (audio model) was measured on our
Hindi clips (eval_turn.py): it caught 65 % of such pauses but also held 25 %
of finished sentences, which would add delay to normal turns.

Hindi is verb-final, so the transcript itself is a strong signal: a turn
whose last word is a connective / postposition / determiner ("कि", "जो",
"और", "एक", "में", "लगभग", "कुछ"…) is not finished. This strategy holds the
turn for up to HOLD_S when the transcript ends like that, and ends it
immediately otherwise — so finished sentences pay no extra latency. If the
customer resumes, their words join the same turn.
"""

import asyncio
import re

from loguru import logger

from pipecat.turns.user_stop.external_user_turn_stop_strategy import ExternalUserTurnStopStrategy

# Words after which a Hindi/Hinglish sentence cannot end.
CONTINUATION = {
    # connectives
    "कि", "जो", "जब", "जिस", "जिसमें", "उसमें", "इसमें", "जैसे", "और", "या", "फिर", "लेकिन", "पर", "तो", "मतलब", "क्योंकि", "अगर",
    # postpositions. Not "तक"/"वाला": "पंद्रह सौ तक", "गोल वाला" are whole
    # answers to "budget?" / "which style?".
    "में", "का", "की", "के", "को", "से",
    # determiners / quantities waiting for a noun. Not "दो": "दिखा दो" is a
    # finished request.
    "एक", "वो", "वह", "ये", "यह", "उस", "इस", "कुछ", "लगभग", "करीब", "कोई", "मेरा", "मेरी",
    # fillers
    "अं", "उम", "उम्म", "हम्म", "एम",
    # romanised / English
    "ki", "jo", "aur", "ya", "phir", "lekin", "toh", "to", "matlab", "jaise", "mein", "ka", "ke", "ko", "se",
    "ek", "wo", "woh", "ye", "kuch", "lagbhag", "and", "or", "but", "the", "a", "an", "like", "some", "so",
    "um", "uh", "with", "for", "of", "my",
}
_PUNCT = "।.,?!…:;-—\"'"


def looks_incomplete(text: str) -> bool:
    """True if a transcript clearly stops mid-sentence."""
    t = text.strip()
    if not t or t.endswith("?"):
        return False
    words = [w.strip(_PUNCT) for w in t.split()]
    words = [w for w in words if w]
    if not words:
        return False
    if words[-1].lower() in CONTINUATION:
        # A lone word ("ये", "कुछ") can be a whole reply to a question.
        return len(words) > 1
    # Phone number being dictated: 1–9 digits so far after "नंबर/number".
    if re.search(r"नंबर|number|मोबाइल|mobile", t, re.I):
        digits = re.sub(r"\D", "", t)
        if 0 < len(digits) < 10:
            return True
    return False


class HindiAwareTurnStopStrategy(ExternalUserTurnStopStrategy):
    """ExternalUserTurnStopStrategy that waits out mid-sentence pauses."""

    HOLD_S = 2.0

    def __init__(self, *, hold_s: float | None = None, extra_incomplete=None, **kwargs):
        """extra_incomplete: optional callable(text) -> bool for context the
        transcript alone can't show, e.g. "we asked for name AND number and
        only the name has come" (bot.py wires this to the flow node)."""
        super().__init__(**kwargs)
        self._hold_s = self.HOLD_S if hold_s is None else hold_s
        self._extra_incomplete = extra_incomplete
        self._hold: asyncio.Task | None = None
        self.held = 0

    async def _reset(self):
        await super()._reset()
        self._cancel_hold()

    def _cancel_hold(self):
        if self._hold and not self._hold.done():
            self._hold.cancel()
        self._hold = None

    async def _handle_user_started_speaking(self, *, announced_elsewhere: bool):
        # The customer went on: drop the pending stop, keep the turn open.
        self._cancel_hold()
        await super()._handle_user_started_speaking(announced_elsewhere=announced_elsewhere)

    async def _handle_transcription(self, frame):
        await super()._handle_transcription(frame)
        # New words while held: the hold was decided on older text (the
        # stop proposal can arrive before the transcript of the words that
        # resumed the sentence). Drop it; the next proposal re-judges the
        # full text, and the strategy's poll fires within `timeout`.
        if self._hold is not None and not self._incomplete(self._text):
            self._cancel_hold()

    def _incomplete(self, text: str) -> bool:
        if looks_incomplete(text):
            return True
        try:
            return bool(self._extra_incomplete and self._extra_incomplete(text))
        except Exception:  # noqa: BLE001 — a hint must never block a turn
            return False

    async def trigger_user_turn_stopped(self, *, enable_user_speaking_frames: bool | None = None):
        if self._hold is not None:
            return  # already waiting; the hold task finishes the turn
        if self._hold_s > 0 and self._incomplete(self._text):
            self.held += 1
            logger.info(f"Turn held {self._hold_s:.1f}s — transcript ends mid-sentence: {self._text!r}")

            async def finish_later():
                try:
                    await asyncio.sleep(self._hold_s)
                except asyncio.CancelledError:
                    return
                self._hold = None
                if not self._user_speaking:
                    await ExternalUserTurnStopStrategy.trigger_user_turn_stopped(
                        self, enable_user_speaking_frames=enable_user_speaking_frames
                    )

            self._hold = self.create_task(finish_later(), f"{self}::hold")
            return
        await super().trigger_user_turn_stopped(enable_user_speaking_frames=enable_user_speaking_frames)
