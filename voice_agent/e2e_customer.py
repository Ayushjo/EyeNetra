"""
e2e_customer.py — a simulated customer talks to the running bot, end to end.

Connects to bot.py exactly like the browser does (SmallWebRTC offer to
/api/offer, an RTVI data channel, a live microphone track), speaks Hindi
lines synthesised by Sarvam TTS in a voice that is not the bot's, LISTENS to
the bot's live transcript and decides each reply from what the bot actually
said. It records, per turn:

  stt_ms      customer stops speaking → final user transcript
  reply_ms    customer stops speaking → bot's first audio (what a customer feels)
  tryon_ms    try_on_frame message relative to the bot starting to speak
  heard       what STT heard        said: what the bot said

and checks the store journey: greet → needs → budget/style (with a
mid-sentence pause, which must NOT be cut) → frame shown → next → like →
executive → contact → goodbye, plus the UI events (try_on_frame with
price/shape/index, liked, session_end).

Usage: .venv/bin/python e2e_customer.py [--url http://localhost:7860/api/offer]
"""

import argparse
import asyncio
import fractions
import json
import re
import time
import uuid

import av
import httpx
import numpy as np
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription

from eval_accuracy import SR, tts

OUT_SR = 48000
FRAME = 960  # 20 ms at 48 kHz
VOICE = "ritu"  # bot speaks as "shubh"


class MicTrack(MediaStreamTrack):
    """Live microphone: plays queued customer speech, silence otherwise."""

    kind = "audio"

    def __init__(self):
        super().__init__()
        self._buf = np.zeros(0, dtype=np.int16)
        self._pts = 0
        self._t0 = None
        self.speech_end_at: float | None = None

    def say(self, pcm16k: np.ndarray):
        x = np.arange(len(pcm16k) * 3) / 3
        up = np.interp(x, np.arange(len(pcm16k)), pcm16k).astype(np.int16)
        self._buf = np.concatenate([self._buf, up])

    def pause(self, seconds: float):
        self._buf = np.concatenate([self._buf, np.zeros(int(seconds * OUT_SR), dtype=np.int16)])

    @property
    def busy(self) -> bool:
        return len(self._buf) > 0

    async def recv(self):
        if self._t0 is None:
            self._t0 = time.monotonic()
        # Real-time pacing.
        target = self._t0 + self._pts / OUT_SR
        delay = target - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        if len(self._buf) > 0:
            if len(self._buf) < FRAME:  # pad the tail to a whole 20 ms frame
                self._buf = np.concatenate([self._buf, np.zeros(FRAME - len(self._buf), dtype=np.int16)])
            chunk, self._buf = self._buf[:FRAME], self._buf[FRAME:]
            if len(self._buf) == 0:
                self.speech_end_at = time.monotonic()
        else:
            chunk = np.zeros(FRAME, dtype=np.int16)
        frame = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = OUT_SR
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, OUT_SR)
        self._pts += FRAME
        return frame


class Customer:
    def __init__(self):
        self.events: list[tuple[float, str, dict]] = []
        self.bot_text = ""  # current bot turn
        self.bot_turns: list[str] = []
        self.bot_speaking = False
        self.bot_audio_at: float | None = None  # first loud bot audio frame after our speech
        self.turn_q: asyncio.Queue[str] = asyncio.Queue()
        self.tryons: list[tuple[float, dict]] = []
        self.ui: list[dict] = []
        self.user_finals: list[tuple[float, str]] = []

    def on_message(self, raw):
        try:
            m = json.loads(raw)
        except Exception:
            return
        if m.get("label") != "rtvi-ai":
            return
        t, d = m.get("type"), m.get("data") or {}
        now = time.monotonic()
        self.events.append((now, t, d))
        if t == "bot-started-speaking":
            self.bot_speaking = True
        elif t == "bot-tts-text":
            txt = (d.get("text") or "").strip()
            if txt:
                self.bot_text = f"{self.bot_text} {txt}".strip()
        elif t == "bot-stopped-speaking":
            self.bot_speaking = False
            # A bot "turn" can be several speak segments; wait a beat in the loop.
        elif t == "user-transcription" and d.get("final"):
            self.user_finals.append((now, d.get("text", "")))
        elif t == "server-message":
            self.ui.append(d)
            if d.get("kind") == "try_on_frame":
                self.tryons.append((now, d))


FILLERS = ("एक सेकंड जी", "हाँ जी, देखता हूँ", "एक मिनट")


async def wait_bot_turn(c: Customer, timeout=25.0, settle=1.2) -> str:
    """Wait until the bot has spoken and then stayed quiet for `settle` s.
    A thinking filler ("एक सेकंड जी…") alone is not the bot's answer."""
    t0 = time.monotonic()
    spoke = False
    quiet_since = None
    while time.monotonic() - t0 < timeout:
        if c.bot_speaking:
            spoke, quiet_since = True, None
        elif spoke:
            quiet_since = quiet_since or time.monotonic()
            only_filler = c.bot_text.strip(" …") in FILLERS or all(
                p.strip(" …।") in FILLERS for p in re.split(r"…", c.bot_text) if p.strip(" …।"))
            if time.monotonic() - quiet_since >= settle and not only_filler:
                text, c.bot_text = c.bot_text, ""
                c.bot_turns.append(text)
                return text
        await asyncio.sleep(0.05)
    text, c.bot_text = c.bot_text, ""
    c.bot_turns.append(text)
    return text if spoke else ""


def choose_reply(said: str, state: dict) -> list:
    """Decide what the customer says next, from what the bot just said.
    Returns a list of segments: str to speak, float to pause."""
    s = said
    if re.search(r"नंबर", s) and not re.search(r"नाम", s):
        return ["नंबर है नौ आठ सात छह पाँच चार तीन दो एक शून्य।"]
    if re.search(r"नाम", s):
        return ["मेरा नाम राहुल शर्मा है।", 0.6, "नंबर है नौ आठ सात छह पाँच चार तीन दो एक शून्य।"]
    if re.search(r"executive|एग्ज़?ीक्यूटिव|एक्ज़?ीक्यूटिव", s, re.I):
        return ["हाँ, executive से बात करवा दीजिए।"]
    if re.search(r"पसंद आया|अगला दिखाऊँ|अगला दिखाऊं", s):
        state["shown"] = state.get("shown", 0) + 1
        return ["अगला दिखाओ।"] if state["shown"] == 1 else ["हाँ, ये वाला अच्छा है, यही लूँगा।"]
    if re.search(r"बजट|स्टाइल", s):
        # Deliberate mid-sentence pause: the turn must not end at "लगभग".
        return ["मेरा बजट है लगभग", 1.3, "तीन हज़ार, गोल वाला दिखाइए।"]
    if re.search(r"धन्यवाद|executive अभी|मिलेंगे", s):
        return []
    if re.search(r"दोबारा|फिर से|समझ नहीं|repeat", s, re.I):
        return state.get("last", [])
    if re.search(r"क्या देख रहे|स्वागत", s):
        return ["मुझे नज़र का चश्मा बनवाना है।"]
    return state.get("last", [])


async def main(url: str):
    c = Customer()
    mic = MicTrack()
    pc = RTCPeerConnection()
    pc.addTrack(mic)
    dc = pc.createDataChannel("chat", ordered=True)
    dc.on("message", c.on_message)

    @dc.on("open")
    def _open():
        dc.send(json.dumps({"label": "rtvi-ai", "type": "client-ready", "id": str(uuid.uuid4()),
                            "data": {"version": "1.0.0", "about": {"library": "e2e_customer"}}}))

    @pc.on("track")
    def _track(track):
        async def drain():
            while True:
                try:
                    f = await track.recv()
                except Exception:
                    return
                a = f.to_ndarray().astype(np.float32)
                if mic.speech_end_at and c.bot_audio_at is None and np.sqrt(np.mean(a * a)) > 300:
                    c.bot_audio_at = time.monotonic()
        asyncio.ensure_future(drain())

    await pc.setLocalDescription(await pc.createOffer())
    async with httpx.AsyncClient() as http:
        r = await http.post(url, json={"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}, timeout=30)
        r.raise_for_status()
        ans = r.json()
        await pc.setRemoteDescription(RTCSessionDescription(sdp=ans["sdp"], type=ans["type"]))

        # Keep-alive pings like the browser transport.
        async def ping():
            while True:
                await asyncio.sleep(1)
                if dc.readyState == "open":
                    dc.send(f"ping: {int(time.time() * 1000)}")
        pinger = asyncio.ensure_future(ping())

        t_start = time.monotonic()
        greeting = await wait_bot_turn(c, timeout=30)
        print(f"BOT  (greeting, {time.monotonic() - t_start:.1f}s after connect): {greeting}\n")

        state: dict = {}
        turns = []
        said = greeting
        for _ in range(12):
            segs = choose_reply(said, state)
            if not segs:
                break
            state["last"] = segs
            n_final, n_try = len(c.user_finals), len(c.tryons)
            for seg in segs:
                if isinstance(seg, str):
                    mic.say(await tts(http, seg, VOICE))
                else:
                    mic.pause(seg)
            mic.speech_end_at = None
            c.bot_audio_at = None
            while mic.busy:
                await asyncio.sleep(0.02)
            end = mic.speech_end_at or time.monotonic()
            said = await wait_bot_turn(c)
            finals = c.user_finals[n_final:]
            heard = " | ".join(t for _, t in finals)
            stt_ms = (finals[-1][0] - end) * 1000 if finals else None
            reply_ms = (c.bot_audio_at - end) * 1000 if c.bot_audio_at else None
            new_try = c.tryons[n_try:]
            spoken = " ".join(s for s in segs if isinstance(s, str))
            turns.append(dict(said=spoken, heard=heard, stt_ms=stt_ms, reply_ms=reply_ms, bot=said,
                              tryon=[d["name"] for _, d in new_try], n_finals=len(finals)))
            print(f"YOU  : {spoken}")
            print(f"HEARD: {heard or '—'}  ({len(finals)} transcript(s); stt {stt_ms and round(stt_ms)} ms)")
            print(f"BOT  : {said or '— (silent)'}  (first audio {reply_ms and round(reply_ms)} ms after you stopped)")
            for _, d in new_try:
                print(f"  ⟶ try_on_frame: {d.get('name')} ₹{d.get('price')} {d.get('shape')} "
                      f"{(d.get('index') or 0) + 1}/{d.get('total')}  ({d.get('frameId')}/{d.get('variantId')})")
            print()
            if any(e.get("kind") == "session_end" for e in c.ui):
                break

        pinger.cancel()
        await pc.close()

    # ---- verdict ---------------------------------------------------------
    kinds = [e.get("kind") for e in c.ui]
    lat = [t["reply_ms"] for t in turns if t["reply_ms"]]
    checks = {
        "greeting spoken": bool(greeting),
        "mid-sentence pause not cut (budget turn = 1 transcript turn → one bot reply)":
            any("लगभग" in t["said"] and t["tryon"] for t in turns),
        "frame shown on budget answer": any(t["tryon"] for t in turns),
        "'next' showed a different frame": len({d["sku"] for _, d in c.tryons}) >= 2,
        "try_on_frame carries price/shape/index/total": bool(c.tryons) and all(
            k in c.tryons[0][1] for k in ("price", "shape", "index", "total")),
        "liked event": "liked" in kinds,
        "session_end event": "session_end" in kinds,
    }
    print("=" * 70)
    for k, v in checks.items():
        print(f"{'PASS' if v else 'FAIL'}  {k}")
    if lat:
        print(f"\nreply latency (you stop → bot audio): median {np.median(lat):.0f} ms, max {max(lat):.0f} ms over {len(lat)} turns")
    stt = [t["stt_ms"] for t in turns if t["stt_ms"] is not None]
    if stt:
        print(f"STT final transcript after you stop: median {np.median(stt):.0f} ms")
    for t, d in c.tryons:
        sp = [e for e in c.events if e[1] == "bot-started-speaking" and e[0] >= t - 0.05]
        if sp:
            print(f"try_on_frame {d['name']}: {(sp[0][0] - t) * 1000:.0f} ms BEFORE the bot starts announcing it")
    json.dump(dict(turns=turns, ui=c.ui, checks=checks), open("eval_cache/e2e_last.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:7860/api/offer")
    asyncio.run(main(ap.parse_args().url))
