"""
eval_turn.py — does Smart Turn v3 (pipecat's bundled end-of-turn model)
tell a finished Hindi sentence from one the customer paused in the middle of?

Today the turn ends when Sarvam's VAD hears silence, so "मेरा बजट है… (pause)
दो हज़ार" gets cut at the pause. Smart Turn listens to the last 8 s of audio
and predicts whether the speaker is done. Here: complete and deliberately
incomplete utterances (synthesised, two voices) → the model's verdict.

Usage: .venv/bin/python eval_turn.py
"""

import asyncio
import time

import httpx
import numpy as np

from eval_accuracy import CONFIGS, SR, stt, tts, wav_bytes
from turn_completion import looks_incomplete
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3

COMPLETE = [
    "मुझे नज़र का चश्मा बनवाना है।",
    "बजट पंद्रह सौ तक है, गोल वाला चाहिए।",
    "अगला दिखाओ।",
    "ये वाला अच्छा लग रहा है, यही लेंगे।",
    "आँखों की जाँच करवानी है।",
    "हाँ, executive से बात करवा दीजिए।",
    "दो हज़ार के अंदर कुछ aviator दिखाओ।",
    "बस रहने दीजिए, बाद में आऊँगा।",
    "इसकी कीमत कितनी है?",
    "मेरा नाम राहुल शर्मा है।",
]
# Customer stops to think — the sentence is clearly not finished.
INCOMPLETE = [
    "मेरा बजट है लगभग",
    "मुझे वो वाला जो",
    "दो हज़ार के अंदर कुछ",
    "मेरा नंबर है नौ आठ सात",
    "मुझे चाहिए एक",
    "वो जो पिछला था उसमें",
    "मैं सोच रहा था कि",
    "हमें दो चश्मे चाहिए, एक मेरे लिए और एक",
    "गोल वाला नहीं, मुझे वो",
    "sunglasses में कुछ",
]


async def main():
    an = LocalSmartTurnAnalyzerV3()
    an.set_sample_rate(SR)
    rows = []
    async with httpx.AsyncClient() as client:
        for label, texts in (("complete", COMPLETE), ("incomplete", INCOMPLETE)):
            for v in ("shubh", "ritu"):
                for t in texts:
                    pcm = await tts(client, t, v) / 32768.0
                    # 200 ms of trailing silence, as VAD would deliver it.
                    audio = np.concatenate([pcm, np.zeros(int(0.2 * SR), dtype=np.float32)]).astype(np.float32)
                    t0 = time.perf_counter()
                    r = an._predict_endpoint(audio)
                    ms = (time.perf_counter() - t0) * 1000
                    heard = await stt(client, wav_bytes(audio * 32768.0), CONFIGS["transcribe"])
                    rows.append((label, v, t, r["prediction"], r["probability"], ms, heard))
    for label in ("complete", "incomplete"):
        sel = [r for r in rows if r[0] == label]
        right = sum(1 for r in sel if (r[3] == 1) == (label == "complete"))
        print(f"{label:10} judged correctly {right}/{len(sel)} = {right / len(sel):.0%}")
    print(f"inference {np.median([r[5] for r in rows]):.0f} ms median\n")
    print("Transcript rule (turn_completion.looks_incomplete on Sarvam's transcript):")
    for label in ("complete", "incomplete"):
        sel = [r for r in rows if r[0] == label]
        right = sum(1 for r in sel if looks_incomplete(r[6]) == (label == "incomplete"))
        print(f"{label:10} judged correctly {right}/{len(sel)} = {right / len(sel):.0%}")
    print()
    for r in rows:
        ok = (r[3] == 1) == (r[0] == "complete")
        ok2 = looks_incomplete(r[6]) == (r[0] == "incomplete")
        print(f"audio {'✓' if ok else '✗'} text {'✓' if ok2 else '✗'} {r[0]:10} {r[1]:5} p={r[4]:.2f}  heard: {r[6]}")


asyncio.run(main())
