"""
e2e_kiosk.py — the whole kiosk, end to end, in a real browser.

Drives headless Chrome over the DevTools protocol against the running Next
app (/?e2e=1: fake camera = rendered face that MediaPipe tracks, fake mic =
Web Audio) and the running bot.py. A scripted customer LISTENS (reads the
live caption/stage from the page), speaks real Sarvam TTS audio into the
fake mic, taps buttons like a customer would, and the run checks:

  * the face is NOT shown before the consultation (SOP)          — every stage
  * stages follow the SOP order; the profile card fills in
  * the mirror opens at try-on with the bot's frame on the face
  * touch actions (next / choose) work like speech
  * the staff dashboard API has the session, profile, transcript, order
  * handoff: AI stops after its line; staff accept → kiosk shows the name;
    staff close → kiosk resets to the welcome screen
  * the "call staff" button and the staff take-over both stop the AI

Screenshots of every stage go to --shots.

Usage: .venv/bin/python e2e_kiosk.py [--scenario all|purchase|button|takeover|sunglasses] [--shots DIR]
"""

import argparse
import asyncio
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

import httpx
import websockets

sys.path.insert(0, str(Path(__file__).parent))
from eval_accuracy import tts, wav_bytes  # noqa: E402

APP = os.environ.get("KIOSK_URL", "http://127.0.0.1:3000")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PUBLIC = Path(__file__).resolve().parent.parent / "public" / "__e2e"
VOICE = "ritu"
CDP_PORT = 9333

results: list[tuple[str, bool, str]] = []


def check(name: str, cond: bool, detail: str = "") -> bool:
    results.append((name, bool(cond), detail))
    print(("  PASS " if cond else "  FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""), flush=True)
    return bool(cond)


class Page:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0
        self.pending: dict[int, asyncio.Future] = {}
        self.errors: list[str] = []
        self.reader = asyncio.create_task(self._read())

    async def _read(self):
        async for raw in self.ws:
            msg = json.loads(raw)
            if "id" in msg and msg["id"] in self.pending:
                self.pending.pop(msg["id"]).set_result(msg)
            elif msg.get("method") == "Runtime.exceptionThrown":
                d = msg["params"]["exceptionDetails"]
                self.errors.append(f"exception: {d.get('text')} {d.get('exception', {}).get('description', '')[:200]}")
            elif msg.get("method") == "Runtime.consoleAPICalled" and msg["params"].get("type") == "error":
                text = " ".join(str(a.get("value", a.get("description", ""))) for a in msg["params"].get("args", []))
                self.errors.append(f"console.error: {text[:300]}")

    async def send(self, method, **params):
        self.n += 1
        fut = asyncio.get_event_loop().create_future()
        self.pending[self.n] = fut
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        msg = await asyncio.wait_for(fut, 60)
        if "error" in msg:
            raise RuntimeError(f"{method}: {msg['error']}")
        return msg.get("result", {})

    async def js(self, expr: str, await_promise: bool = False):
        r = await self.send("Runtime.evaluate", expression=expr, awaitPromise=await_promise, returnByValue=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(f"JS error: {r['exceptionDetails'].get('text')} {r['exceptionDetails'].get('exception', {}).get('description', '')[:300]}")
        return r.get("result", {}).get("value")

    async def shot(self, path: Path):
        r = await self.send("Page.captureScreenshot", format="png")
        path.write_bytes(base64.b64decode(r["data"]))


STATE_JS = """(() => {
  const v = window.__e2e?.voice?.getState?.();
  const t = window.__e2e?.tryOn?.getState?.();
  if (!v) return null;
  const s = v.session;
  const root = document.querySelector('[data-view]');
  const mirror = document.querySelector('[data-testid=kiosk-mirror]');
  return {
    view: root?.dataset.view, status: v.status, phase: v.phase, caption: v.botCaption,
    stage: s?.stage ?? null, actions: s?.actions ?? [], current: s?.current ?? null,
    set: (s?.set ?? []).map(f => ({sku: f.sku, frameId: f.frameId, name: f.name})),
    shortlist: s?.shortlist ?? [], chosen: s?.chosen ?? null, lens: s?.lens ?? null, total: s?.total ?? null,
    handoff: s?.handoff ?? null, contact: s?.contact ?? null, profile: s?.profile ?? {},
    staff: v.staff, localHandoff: v.localHandoff, transcript: v.transcript.length,
    mirrorVisible: mirror?.dataset.visible === 'true', frameOnFace: t?.selectedFrameId ?? null,
    hasFace: !!t?.hasFace, activeSku: v.activeSku,
    profileCard: document.querySelector('[data-testid=profile-card]')?.innerText ?? null,
    handoffTitle: document.querySelector('[data-testid=handoff-title]')?.innerText ?? null,
  };
})()"""


async def state(p: Page) -> dict:
    return await p.js(STATE_JS) or {}


async def wait_for(p: Page, pred, timeout: float = 30.0, every: float = 0.15) -> dict:
    t0 = time.time()
    st = {}
    while time.time() - t0 < timeout:
        st = await state(p)
        if st and pred(st):
            return st
        await asyncio.sleep(every)
    raise TimeoutError(f"timed out; last state: stage={st.get('stage')} phase={st.get('phase')} view={st.get('view')} caption={st.get('caption', '')[:80]!r}")


async def wait_bot_done(p: Page, timeout: float = 40.0) -> dict:
    """Bot spoke and is now listening (stable 700 ms)."""
    await wait_for(p, lambda s: s.get("phase") == "speaking", timeout)
    t_stable = None
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = await state(p)
        if s.get("phase") == "listening":
            t_stable = t_stable or time.time()
            if time.time() - t_stable > 0.7:
                return s
        else:
            t_stable = None
        await asyncio.sleep(0.1)
    raise TimeoutError("bot never finished speaking")


async def say(p: Page, client: httpx.AsyncClient, text: str):
    pcm = await tts(client, text, VOICE)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    name = f"k_{zlib.crc32(text.encode())}.wav"
    (PUBLIC / name).write_bytes(wav_bytes(pcm))
    print(f"  YOU : {text}", flush=True)
    await p.js(f"window.__e2eSay('/__e2e/{name}')", await_promise=True)


async def api_session(client: httpx.AsyncClient, sid: str) -> dict:
    r = await client.get(f"{APP}/api/sessions/{sid}")
    return r.json() if r.status_code == 200 else {}


async def kiosk_sid(p: Page) -> str:
    return await p.js("window.__e2e.kiosk?.getState?.().sessionId ?? null")


async def open_page(port: int) -> Page:
    async with httpx.AsyncClient() as c:
        tab = (await c.put(f"http://127.0.0.1:{port}/json/new?about:blank")).json()
    ws = await websockets.connect(tab["webSocketDebuggerUrl"], max_size=50_000_000)
    p = Page(ws)
    await p.send("Page.enable")
    await p.send("Runtime.enable")
    await p.send("Emulation.setDeviceMetricsOverride", width=1920, height=1080, deviceScaleFactor=1, mobile=False)
    return p


async def fresh_kiosk(p: Page):
    await p.send("Page.navigate", url=f"{APP}/?e2e=1")
    await wait_for(p, lambda s: s.get("view") == "welcome", 60)
    await asyncio.sleep(0.5)


PRE_MIRROR = {"greet", "rx", "lifestyle", "style"}


# ---------------------------------------------------------------------------
async def scenario_purchase(p: Page, client: httpx.AsyncClient, shots: Path):
    print("\n=== Scenario: power glasses, full SOP journey, touch + voice, staff handoff ===", flush=True)
    await fresh_kiosk(p)
    await p.shot(shots / "01_welcome.png")
    await p.js("document.querySelector('[data-testid=start]').click()")
    t0 = time.time()
    st = await wait_for(p, lambda s: s.get("stage") == "greet" and s.get("phase") == "speaking", 40)
    check("greeting starts after tap", True, f"{time.time() - t0:.1f}s")
    check("consult view, face hidden at greeting", st["view"] == "consult" and not st["mirrorVisible"])
    st = await wait_bot_done(p)
    await p.shot(shots / "02_greet.png")
    sid = await kiosk_sid(p)

    seen_stages = ["greet"]
    replies = {
        "greet": ["मुझे नज़र का चश्मा बनवाना है।"],
        "rx": ["तीन साल पहले जाँच करवाई थी।", "हाँ, करवा लेंगे।"],
        "lifestyle": ["दिन में आठ घंटे laptop पर काम करता हूँ।", "नहीं, पास का ठीक दिखता है।"],
        "style": ["बजट पाँच हज़ार तक है, आप ही अच्छा दिखाइए।"],
    }
    used = {k: 0 for k in replies}
    # Consultation: speak until the try-on stage.
    for _ in range(10):
        stage = st["stage"]
        check(f"[{stage}] face not shown before try-on", not st["mirrorVisible"])
        lines = replies.get(stage, [])
        if used.get(stage, 0) >= len(lines):
            raise RuntimeError(f"no scripted reply left for stage {stage}: caption {st['caption']!r}")
        text = lines[used[stage]]
        used[stage] += 1
        await say(p, client, text)
        st = await wait_bot_done(p)
        print(f"  BOT : [{st['stage']}] {st['caption']}", flush=True)
        if st["stage"] not in seen_stages:
            seen_stages.append(st["stage"])
            await p.shot(shots / f"03_{len(seen_stages):02d}_{st['stage']}.png")
        if st["stage"] == "tryon":
            break

    check("SOP order: need → power → lifestyle → style → try-on",
          seen_stages == ["greet", "rx", "lifestyle", "style", "tryon"], str(seen_stages))
    pc = st.get("profileCard") or ""
    prof = st["profile"]
    check("profile: need=power, rx=old, eye test accepted", prof.get("need") == "power" and prof.get("rx") == "old"
          and prof.get("eye_test") == "accepted", json.dumps(prof, ensure_ascii=False))
    check("profile: 8 h screen, no near difficulty, budget 5000",
          prof.get("screen_hours") == 8 and prof.get("near_difficulty") is False and (prof.get("prefs") or {}).get("max_price") == 5000,
          json.dumps(prof, ensure_ascii=False))
    check("mirror visible at try-on", st["mirrorVisible"] and st["view"] == "mirror")
    check("curated set of 3–4 frames", 3 <= len(st["set"]) <= 4, str(len(st["set"])))
    cur = st["set"][st["current"]]
    check("bot's frame is on the face", st["frameOnFace"] == cur["frameId"], f"{st['frameOnFace']} vs {cur['frameId']}")
    st = await wait_for(p, lambda s: s["hasFace"], 15)
    check("face tracked in the mirror", st["hasFace"])
    await asyncio.sleep(1.5)
    await p.shot(shots / "04_tryon.png")

    # Voice: like it.
    await say(p, client, "ये अच्छा है, पसंद में रख लो।")
    st = await wait_bot_done(p)
    check("voice 'like' → shortlisted", len(st["shortlist"]) == 1, str(st["shortlist"]))

    # Touch: next.
    before = st["current"]
    await p.js("document.querySelector('[data-testid=btn-next]').click()")
    st = await wait_for(p, lambda s: s["current"] == before + 1, 10)
    check("touch 'अगला' → next frame", True)
    st = await wait_for(p, lambda s: s["frameOnFace"] == s["set"][s["current"]]["frameId"], 5)
    check("touch: new frame on the face", True)
    await wait_bot_done(p)
    await asyncio.sleep(1.2)
    await p.shot(shots / "05_tryon_next.png")

    # Voice: choose this one.
    await say(p, client, "हाँ, यही लूँगा, फ़ाइनल।")
    st = await wait_bot_done(p)
    print(f"  BOT : [{st['stage']}] {st['caption']}", flush=True)
    check("choose → lens stage (frame first, lens second)", st["stage"] == "lens" and st["chosen"])
    await p.shot(shots / "06_lens.png")

    # Touch: tap the recommended lens.
    rec = await p.js("window.__e2e.voice.getState().session.lenses.find(l => l.recommended).code")
    check("8 h screen + power → Blue-Cut AR recommended", rec == "BLU-AR-01", rec)
    await p.js(f"document.querySelector('[data-testid=lens-{rec}]').click()")
    st = await wait_for(p, lambda s: s["stage"] == "close", 10)
    st = await wait_bot_done(p)
    print(f"  BOT : [{st['stage']}] {st['caption']}", flush=True)
    check("close shows the total", st["total"] and st["lens"] == rec)
    check("caption is the new turn only (no leftover lens line)", st["caption"].startswith("तो फ़ाइनल"), st["caption"][:60])
    await p.shot(shots / "07_close.png")

    api = await api_session(client, sid)
    check("staff API: session live with AI, order total", api.get("status") == "ai" and api.get("session", {}).get("total") == st["total"],
          f"{api.get('status')} {api.get('session', {}).get('total')}")
    check("staff API: transcript recorded", len(api.get("transcript", [])) >= 10, str(len(api.get("transcript", []))))

    await say(p, client, "मेरा नाम राहुल शर्मा है, नंबर है नौ आठ सात छह पाँच चार तीन दो एक शून्य।")
    st = await wait_for(p, lambda s: s["stage"] == "handoff", 30)
    check("contact saved (consent)", (st.get("contact") or {}).get("phone") == "9876543210", json.dumps(st.get("contact"), ensure_ascii=False))
    check("handoff view for billing", st["view"] == "handoff" and st["handoff"]["reason"] == "billing")
    st = await wait_for(p, lambda s: s["status"] == "idle", 25)
    check("AI stops after its handoff line", st["status"] == "idle")
    await p.shot(shots / "08_handoff.png")

    api = await api_session(client, sid)
    check("staff API: waiting for staff", api.get("status") == "waiting", api.get("status"))
    # The staff screen while the customer waits.
    staff = await open_page(CDP_PORT)
    await staff.send("Page.navigate", url=f"{APP}/staff")
    for _ in range(60):
        if await staff.js(f"!!document.querySelector('[data-testid=\"accept-{sid}\"]')"):
            break
        await asyncio.sleep(0.25)
    check("staff dashboard: alert with 'I'm going' for this customer",
          await staff.js(f"!!document.querySelector('[data-testid=\"accept-{sid}\"]')"))
    await staff.js(f"document.querySelector('[data-testid=\"session-{sid}\"]')?.click()")
    await asyncio.sleep(0.8)
    detail = await staff.js("document.querySelector('[data-testid=detail]')?.innerText ?? ''")
    check("staff dashboard: name, phone, frame, lens, total, consultation",
          all(x in detail for x in ("राहुल", "9876543210", "Blue-Cut", "₹2,150" if st["total"] == 2150 else "Total", "पावर का चश्मा")),
          detail[:300])
    await staff.shot(shots / "08b_staff_dashboard.png")
    await staff.send("Page.close")
    r = await client.post(f"{APP}/api/sessions/{sid}", json={"action": "accept", "name": "सुरेश"})
    check("staff accept accepted", r.status_code == 200)
    st = await wait_for(p, lambda s: (s.get("handoffTitle") or "").find("सुरेश") >= 0, 10)
    check("kiosk shows who is coming", "सुरेश" in st["handoffTitle"], st["handoffTitle"])
    await p.shot(shots / "09_staff_coming.png")
    r = await client.post(f"{APP}/api/sessions/{sid}", json={"action": "close", "name": "सुरेश"})
    st = await wait_for(p, lambda s: s.get("view") == "welcome", 20)
    check("staff close → kiosk back to welcome", st["view"] == "welcome")
    api = await api_session(client, sid)
    check("staff API: closed", api.get("status") == "closed", api.get("status"))
    leads = json.loads((Path(__file__).parent / "leads.json").read_text())
    check("lead saved with chosen frame", any(l.get("phone") == "9876543210" for l in leads))
    return sid


async def scenario_button(p: Page, client: httpx.AsyncClient, shots: Path):
    print("\n=== Scenario: customer presses 'स्टाफ़ को बुलाएँ' mid-consultation ===", flush=True)
    await fresh_kiosk(p)
    await p.js("document.querySelector('[data-testid=start]').click()")
    await wait_bot_done(p)
    await say(p, client, "पावर का चश्मा चाहिए।")
    st = await wait_bot_done(p)
    check("reached prescription question", st["stage"] == "rx", st["stage"])
    await p.js("document.querySelector('[data-testid=call-staff]').click()")
    st = await wait_for(p, lambda s: s["stage"] == "handoff", 10)
    check("button → handoff (reason customer_button)", st["handoff"]["reason"] == "customer_button")
    st = await wait_bot_done(p)
    check("AI says staff are coming", "स्टाफ़" in st["caption"], st["caption"])
    st = await wait_for(p, lambda s: s["status"] == "idle", 20)
    check("AI disconnects after the line", True)
    sid = await kiosk_sid(p)
    api = await api_session(client, sid)
    check("staff API: waiting, need=power visible", api.get("status") == "waiting" and api["session"]["profile"].get("need") == "power")
    await p.shot(shots / "10_button_handoff.png")
    await client.post(f"{APP}/api/sessions/{sid}", json={"action": "close"})
    await wait_for(p, lambda s: s.get("view") == "welcome", 20)

    # Button on the welcome screen (AI never started).
    await p.js("document.querySelector('[data-testid=call-staff]').click()")
    st = await wait_for(p, lambda s: s.get("view") == "handoff", 10)
    check("button on welcome → handoff screen without the AI", st["status"] == "idle" and st["localHandoff"])
    await asyncio.sleep(2.5)
    sid = await kiosk_sid(p)
    api = await api_session(client, sid)
    check("staff API: waiting (kiosk button)", api.get("status") == "waiting", api.get("status"))
    await client.post(f"{APP}/api/sessions/{sid}", json={"action": "close"})
    await wait_for(p, lambda s: s.get("view") == "welcome", 20)


async def scenario_takeover(p: Page, client: httpx.AsyncClient, shots: Path):
    print("\n=== Scenario: staff take over from the dashboard ===", flush=True)
    await fresh_kiosk(p)
    await p.js("document.querySelector('[data-testid=start]').click()")
    await wait_bot_done(p)
    sid = await kiosk_sid(p)
    await asyncio.sleep(2.5)
    r = await client.post(f"{APP}/api/sessions/{sid}", json={"action": "takeover", "name": "अनीता"})
    check("takeover accepted by API", r.status_code == 200)
    st = await wait_for(p, lambda s: s["view"] == "handoff" and s["status"] == "idle", 10)
    check("kiosk: AI stopped, handoff screen with staff name", "अनीता" in (st.get("handoffTitle") or ""), st.get("handoffTitle"))
    await p.shot(shots / "11_takeover.png")
    await client.post(f"{APP}/api/sessions/{sid}", json={"action": "close"})
    await wait_for(p, lambda s: s.get("view") == "welcome", 20)


async def scenario_sunglasses(p: Page, client: httpx.AsyncClient, shots: Path):
    print("\n=== Scenario: sunglasses, guest path, warm exit ===", flush=True)
    await fresh_kiosk(p)
    await p.js("document.querySelector('[data-testid=start]').click()")
    await wait_bot_done(p)
    script = [
        ("greet", "धूप का चश्मा दिखाइए।", "lifestyle"),
        ("lifestyle", "ड्राइविंग के लिए चाहिए।", "style"),
        ("style", "कोई भी, आप ही दिखाइए।", "tryon"),
    ]
    for stage, text, nxt in script:
        await say(p, client, text)
        st = await wait_bot_done(p)
        print(f"  BOT : [{st['stage']}] {st['caption']}", flush=True)
        check(f"{stage} → {nxt}", st["stage"] == nxt, st["stage"])
        if st["stage"] != "tryon":
            check(f"[{st['stage']}] face hidden", not st["mirrorVisible"])
    check("no prescription step for sunglasses", True)
    await say(p, client, "सोच के बताता हूँ, बाद में आऊँगा।")
    st = await wait_for(p, lambda s: s["stage"] == "done", 25)
    check("leave → warm exit screen", st["view"] == "done")
    await wait_bot_done(p)
    await p.shot(shots / "12_warm_exit.png")
    await p.js("document.querySelector('[data-view] button.mt-auto')?.click()")
    st = await wait_for(p, lambda s: s.get("view") == "welcome", 20)
    check("warm exit → next customer", True)


async def scenario_walkaway(p: Page, client: httpx.AsyncClient, shots: Path):
    print("\n=== Scenario: customer walks away mid-conversation (idle 10 s for the test) ===", flush=True)
    await p.send("Page.navigate", url=f"{APP}/?e2e=1&idle=10000")
    await wait_for(p, lambda s: s.get("view") == "welcome", 60)
    await p.js("document.querySelector('[data-testid=start]').click()")
    await wait_bot_done(p)
    sid = await kiosk_sid(p)
    t0 = time.time()
    st = await wait_for(p, lambda s: s.get("view") == "welcome", 40)
    check("idle → kiosk resets to welcome on its own", True, f"{time.time() - t0:.0f}s")
    check("AI disconnected", st["status"] == "idle")
    await asyncio.sleep(1)
    api = await api_session(client, sid)
    check("staff API: marked left", api.get("status") == "left", api.get("status"))


async def scenario_botdown(p: Page, client: httpx.AsyncClient, shots: Path):
    """Run with bot.py STOPPED."""
    print("\n=== Scenario: voice server down ===", flush=True)
    await fresh_kiosk(p)
    await p.js("document.querySelector('[data-testid=start]').click()")
    st = await wait_for(p, lambda s: s.get("status") == "error", 30)
    check("connection failure shown", bool(await p.js("!!document.querySelector('[data-testid=voice-error]')")))
    check("staff button still available", bool(await p.js("!!document.querySelector('[data-testid=call-staff]')")))
    await p.shot(shots / "13_bot_down.png")
    await p.js("document.querySelector('[data-testid=call-staff]').click()")
    st = await wait_for(p, lambda s: s.get("view") == "handoff", 10)
    check("call staff works without the AI", st["localHandoff"] is not None)
    await asyncio.sleep(2.5)
    sid = await kiosk_sid(p)
    api = await api_session(client, sid)
    check("staff API: waiting", api.get("status") == "waiting", api.get("status"))
    await client.post(f"{APP}/api/sessions/{sid}", json={"action": "close"})
    await wait_for(p, lambda s: s.get("view") == "welcome", 20)


async def scenario_aifail(p: Page, client: httpx.AsyncClient, shots: Path):
    """Run while the AI services fail (e.g. no credit): the kiosk must hand to staff, not freeze."""
    print("\n=== Scenario: AI service failing mid-conversation ===", flush=True)
    await fresh_kiosk(p)
    await p.js("document.querySelector('[data-testid=start]').click()")
    t0 = time.time()
    st = await wait_for(p, lambda s: s.get("view") == "handoff", 45)
    check("AI failure → handoff screen (no frozen kiosk)", (st.get("localHandoff") or {}).get("reason") == "ai_unavailable",
          json.dumps(st.get("localHandoff")))
    check("apology shown", "माफ़ कीजिए" in (st.get("handoffTitle") or ""), st.get("handoffTitle"))
    check(f"within 30 s ({time.time() - t0:.0f}s)", time.time() - t0 < 30)
    await p.shot(shots / "14_ai_failed.png")
    await asyncio.sleep(2.5)
    sid = await kiosk_sid(p)
    api = await api_session(client, sid)
    check("staff alerted (waiting)", api.get("status") == "waiting", api.get("status"))
    await client.post(f"{APP}/api/sessions/{sid}", json={"action": "close"})
    await wait_for(p, lambda s: s.get("view") == "welcome", 20)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="all")
    ap.add_argument("--shots", default=str(Path(tempfile.gettempdir()) / "kiosk_shots"))
    a = ap.parse_args()
    shots = Path(a.shots)
    shots.mkdir(parents=True, exist_ok=True)
    port = CDP_PORT
    prof = tempfile.mkdtemp(prefix="kiosk-chrome-")
    chrome = subprocess.Popen([
        CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
        "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream",
        "--window-size=1920,1080", "--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=metal",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            for _ in range(50):
                try:
                    await c.get(f"http://127.0.0.1:{port}/json/version")
                    break
                except httpx.HTTPError:
                    await asyncio.sleep(0.2)
        p = await open_page(port)
        async with httpx.AsyncClient(timeout=60) as client:
            runs = {"purchase": scenario_purchase, "button": scenario_button,
                    "takeover": scenario_takeover, "sunglasses": scenario_sunglasses,
                    "walkaway": scenario_walkaway, "botdown": scenario_botdown, "aifail": scenario_aifail}
            for name, fn in runs.items():
                if a.scenario == name or (a.scenario == "all" and name not in ("botdown", "aifail")):
                    p.errors.clear()
                    try:
                        await fn(p, client, shots)
                    except Exception as e:  # noqa: BLE001
                        check(f"scenario {name} completed", False, repr(e)[:300])
                        await p.shot(shots / f"ERROR_{name}.png")
                    # MediaPipe logs this INFO line through console.error — not an error.
                    real = [e for e in p.errors if "favicon" not in e and "XNNPACK delegate" not in e
                            and not (name == "botdown" and "Failed to fetch" in e)
                            and not (name == "aifail" and ("Credits" in e or "credits" in e or "Pipecat" in e))]
                    check(f"{name}: no browser errors", not real, " | ".join(real[:3]))
    finally:
        chrome.terminate()
        shutil.rmtree(prof, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed — screenshots in {shots}")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    asyncio.run(main())
