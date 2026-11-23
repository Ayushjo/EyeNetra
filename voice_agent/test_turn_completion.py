"""
test_turn_completion.py — mid-sentence pause detection and the turn hold.

Run with:  .venv/bin/python test_turn_completion.py
"""

import asyncio

import turn_completion as T
from pipecat.turns.user_stop.external_user_turn_stop_strategy import ExternalUserTurnStopStrategy

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


# Sarvam transcripts of finished turns — must never be held (no added latency).
for t in ["मुझे नज़र का चश्मा बनवाना है।", "बजट 1500 तक है, गोल वाला चाहिए।", "अगला दिखाओ।",
          "हाँ एग्जीक्यूटिव से बात करवा दीजिए।", "इसकी कीमत कितनी है?", "गोल वाला", "पंद्रह सौ तक",
          "मुझे वो दिखा दो", "ये", "कुछ", "मेरा नंबर है 9876543210", "हाँ", "nahi", "round wala dikhao"]:
    check(f"complete: {t}", not T.looks_incomplete(t))

for t in ["मेरा बजट है लगभग।", "2000 के अंदर कुछ।", "मैं सोच रहा था कि।", "गोल वाला नहीं मुझे वो।",
          "मेरा नंबर है 987।", "सनग्लासेस में कुछ।", "हमें दो चश्मे चाहिए, एक मेरे लिए और एक।",
          "mujhe round wala aur", "budget around ek"]:
    check(f"incomplete: {t}", T.looks_incomplete(t))


async def hold_behaviour():
    fired = []

    async def fake_super(self, *, enable_user_speaking_frames=None):
        fired.append(self._text)

    orig = ExternalUserTurnStopStrategy.trigger_user_turn_stopped
    ExternalUserTurnStopStrategy.trigger_user_turn_stopped = fake_super
    try:
        s = T.HindiAwareTurnStopStrategy(hold_s=0.2)
        s.create_task = lambda coro, name=None: asyncio.create_task(coro)

        s._text = "अगला दिखाओ।"
        await s.trigger_user_turn_stopped()
        check("finished sentence ends the turn immediately", fired == ["अगला दिखाओ।"])

        fired.clear()
        s._text = "मेरा बजट है लगभग"
        await s.trigger_user_turn_stopped()
        await s.trigger_user_turn_stopped()  # repeated proposals while held are ignored
        check("mid-sentence pause holds the turn", fired == [] and s.held == 1)
        await asyncio.sleep(0.3)
        check("held turn ends after the hold if the customer stays silent", fired == ["मेरा बजट है लगभग"])

        fired.clear()
        s._text = "मेरा बजट है लगभग"
        await s.trigger_user_turn_stopped()
        await s._handle_user_started_speaking(announced_elsewhere=False)
        await asyncio.sleep(0.3)
        check("customer resumes → hold cancelled, turn stays open", fired == [])
        s._text += " दो हज़ार"
        s._user_speaking = False
        await s.trigger_user_turn_stopped()
        check("then the full sentence ends the turn", fired == ["मेरा बजट है लगभग दो हज़ार"])

        # Stop proposal arrives BEFORE the transcript of the resumed words
        # (seen live): the hold must drop as soon as the new words complete it.
        fired.clear()
        s._text = "मेरा बजट है लगभग।"
        await s.trigger_user_turn_stopped()          # held on stale text
        from pipecat.frames.frames import TranscriptionFrame
        await s._handle_transcription(TranscriptionFrame(text=" 3000 गोल वाला दिखाइए।", user_id="", timestamp=""))
        check("late transcript completes the sentence → hold dropped", s._hold is None)
        await s.trigger_user_turn_stopped()
        check("…and the next proposal ends the turn at once", fired == ["मेरा बजट है लगभग। 3000 गोल वाला दिखाइए।"])

        # Context hint: name given, number still to come.
        fired.clear()
        s2 = T.HindiAwareTurnStopStrategy(hold_s=0.2, extra_incomplete=lambda t: "नाम" in t and not any(c.isdigit() for c in t))
        s2.create_task = lambda coro, name=None: asyncio.create_task(coro)
        s2._text = "मेरा नाम राहुल शर्मा है।"
        await s2.trigger_user_turn_stopped()
        check("context hint holds a name-only turn", fired == [] and s2._hold is not None)
        await s2._handle_transcription(TranscriptionFrame(text=" नंबर है 9876543210।", user_id="", timestamp=""))
        await s2.trigger_user_turn_stopped()
        check("number arrives → one turn with both", fired == ["मेरा नाम राहुल शर्मा है। नंबर है 9876543210।"])
    finally:
        ExternalUserTurnStopStrategy.trigger_user_turn_stopped = orig


asyncio.run(hold_behaviour())
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
raise SystemExit(1 if failed else 0)
