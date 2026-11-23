# Eyenetra Voice Agent — Status

## 5 Oct 2026 — real-microphone sessions on the try-on page (measured)

Verified live with a real mic, Hindi/Hinglish speech, same machine
(`bot.py` on :7860, Next.js on :3000, SmallWebRTC):

- STT (Sarvam saaras:v4, hi-IN, server VAD): transcripts arrive ~80 ms after
  END_SPEECH and were accurate for full sentences ("नहीं, कोई खास पसंद नहीं।
  बजट तो है लगभग एक लाख।", "फास्ट ट्रैक वाला कराइए ट्राई।").
- TTS (Sarvam bulbul:v3): TTFB 0.2–0.5 s.
- LLM: **gemini-2.5-flash 1.2–1.7 s TTFB but hard-capped at ~4 req/min on
  this key** (429 on the 5th call, probed); gemini-3.1-flash-lite 3.3–9 s
  and 503s under load. bot.py now uses 2.5-flash as primary with a 60 s
  automatic fallback on quota; a spoken filler covers calls slower than 1.8 s.
  A turn with a tool call is two requests, so the cap is reached after ~2
  exchanges. **Raising the Gemini quota (billing) is the single biggest
  latency fix left.**
- Try-on integration: `try_on_frame` → RTVI server message → frame applied
  to the live face on the SAME page (no navigation; session, mic, transcript
  stay up), banner "Showing: …", card "on your face now", stage scrolled into
  view. Verified end-to-end (Sport Wraparound shown on "दिखाओ").
- PromiseKeeper: if the agent says "dikhaata hoon" without calling the tool
  (happened live at 12:47), the first search result is shown anyway.
- TranscriptGate: one/two-word fragments from other people in the room no
  longer start LLM turns (short real answers like "haan", "nahi", "dikhao"
  are allowed).
- Prompt: one frame on screen at a time, Hindi number words ("pandrah sau"
  verified), no repetition on unclear input; temperature 0.2.
- Fixed: `bot.py` was missing `import asyncio` — the retry path crashed the
  session on the first Gemini 503.

Still unverified / open:
- Barge-in and noisy-shop behaviour (only informal background chatter seen).
- Catalogue is placeholder data; four generic 3D models stand in for ten
  SKUs (map corrected by shape; UI states which model is rendered).
- Deployment topology beyond same-machine localhost (kiosk/HTTPS).

---


Written 18 Aug 2026. Updated 3 Oct 2026 (macOS session — SOP prompt rewrite,
try-on integration, model switch).

---

## 3 Oct 2026 update — SOP alignment + try-on integration

- `system_prompt.txt` — rewritten around the KG Optic customer-journey SOP:
  8 stages (welcome/browse/hurry/repair routing → need → Rx gate → lifestyle
  → frame curation → **try-on & shortlist** → lens+close → handoff/warm exit),
  plus the SOP objection table (mehenga / online sasta / discount / family).
  Store name stays "Eyenetra".
- **Model switch: `gemini-3.1-flash-lite` via `GEMINI_MODEL` in `.env`** —
  this key's free tier caps `gemini-2.5-flash` at 5 req/min (429s mid-
  conversation, verified). `gemini-3.1-flash-lite` is ~1-2.4s, follows the SOP
  prompt + tools correctly, and has a much higher quota. `agent.py` and
  `bot.py` both read `GEMINI_MODEL`. `gemini-2.5-flash-lite` 404s;
  `gemini-3.5-flash`/`3.8-flash` return empty text under tight max_tokens.
- `agent.py` — added `thinking_budget=0` (fixes the verified reasoning-text
  leak on the raw SDK path) and a single 3s retry on transient 429/503.
- **Try-on integration (new):**
  - `data/tryon_map.csv` — maps store SKUs to the try-on app's frame/variant
    ids (`src/data/frames.ts`: aviator, round, sport, ai-frames).
  - `catalogue.py` — loads the map, new `resolve_tryon(sku)`.
  - `tools.py` — new `try_on_frame(sku)` tool; returns tryon ids or a clean
    error for unmapped/unknown SKUs.
  - `bot.py` — tool handler now closes over the PipelineTask and queues an
    `RTVIServerMessageFrame` on successful `try_on_frame` calls; pipecat
    1.12's auto-attached RTVIObserver ships it to the browser as an
    `rtvi-ai`/`server-message` over the data channel.
  - Next.js: `/voice` page (`src/app/voice`, `VoiceAgentPanel`,
    `useVoiceAgent`) connects via `@pipecat-ai/client-js` +
    `SmallWebRTCTransport` to `POST :7860/api/offer`; shows transcript,
    bot-speaking state, and suggestion cards with a "Try on" button that
    navigates to `/?frame=<id>&variant=<id>`; `TryOnStage` applies those
    query params to the try-on store on mount.
- Verified: scenario 01 (full SOP flow, correct tool calls + Hindi number
  coercion + spoken prices as words), 04 (medical → notify_staff), 05
  (competitor → neutral), 10 (free/discount → declined cleanly).
  `next build`, `tsc`, offline suites all pass.

Still open from before: real-mic STT quality, barge-in, store visit data,
kiosk hardware — unchanged.

---

## Verified working (live demo, this session)

`bot.py` runs and a full conversation turn works end-to-end against the real
APIs:

1. `python bot.py` serves `http://localhost:7860`, browser connects over
   WebRTC, mic access granted, Sarvam STT connects, Sarvam TTS connects.
2. Bot speaks its opening greeting aloud (audio confirmed playing in-browser,
   time-to-first-audio 0.53s).
3. Sent (via the playground's text-input field, since this environment has no
   real microphone to speak into) `"Mujhe chashma chahiye, budget 3000 ke aas
   paas"` → bot replied correctly in Hinglish, followed `system_prompt.txt`'s
   conversation order exactly (asked the power-check question next, per Step
   2, instead of jumping ahead).
4. Sent `"Haan power hai, screen time 8 ghante hai, age 28"` → bot called
   `recommend_lens(screen_time_hours=8, has_power=True, age=28)` for real,
   got back `{'lens_code': 'BLU-AR-01', 'name': 'Blue-Cut Anti-Reflective', ...}`
   from `catalogue.py`'s deterministic table (matches `lenses.csv`'s documented
   rule: "has power; screen time 6+ hrs/day; age under 40"), and spoke that
   answer aloud — not an LLM guess.

This confirms the core value proposition — voice in, tool-grounded answer out,
voice back — works. **Not yet confirmed:** real microphone input through
Sarvam STT (only tested via the text-input bypass), barge-in, and everything
in the Part 2 exit gate that needs real spoken audio (see below).

---

## Bugs found and fixed to get here

None of these were guesses — each was hit live against the real Sarvam/Google
APIs and confirmed by the fix resolving it.

1. **`requirements.txt` pinned too loosely (`pipecat-ai>=0.0.60`)** — pip
   resolved to a pre-1.0 release that predates `SarvamSTTService` entirely
   (only `sarvam/tts.py` existed) and pulled in `silero`→`torch`, which pins
   `numpy<2` with no Windows wheel for Python 3.13, breaking the install with
   a compiler error. Fixed: pin `pipecat-ai>=1.0.0,<2.0.0` (upper bound
   because `bot.py` uses `PipelineTask`/`PipelineParams`, deprecated in 1.3.0
   in favor of `PipelineWorker`/removed in 2.0), dropped the unused `silero`
   extra.
2. **`daily-python` has no Windows wheels at all** — only macOS/Linux
   (`manylinux`), for any version. `pipecat-ai[daily]` cannot install on this
   machine. Fixed: switched to Pipecat's own `webrtc` (SmallWebRTC) transport,
   which is pure-Python plus `abi3` wheels (works on Windows) — your explicit
   choice over WSL2. `bot.py` now only registers the `webrtc` transport
   factory; the `DailyParams` import was removed (importing
   `pipecat.transports.daily.transport` at all raises `ImportError` without
   `daily-python` installed, even if you never call it).
3. **`SarvamSTTService(mode="transcribe")` crashes at construction** —
   `saarika:v2.5` (the transcribe-not-translate model the plan specifies)
   doesn't accept a `mode` parameter at all; only `saaras:v3` does. Fixed:
   removed the explicit `mode=`.
4. **Sarvam's server-side VAD was never actually enabled** — needed
   `vad_signals=True` in `SarvamSTTService.Settings` for Sarvam to emit the
   `UserStarted/StoppedSpeakingFrame` pair the turn-stop strategy listens for.
   Fixed: added it.
5. **`SarvamTTSService` defaulted to English** — `language` wasn't set in
   `Settings`, and the field's default is `Language.EN`. Fixed: set
   `Language.HI_IN` explicitly.
6. **Two real bugs in pipecat-ai 1.7.0's `SarvamTTSService._send_config()`**
   (`site-packages/pipecat/services/sarvam/tts.py:1089`), found live: every
   config message was rejected by Sarvam with `"Input parameters has to be a
   valid dictionary"`, so the bot could never speak.
   - It sends the wire key `"target_language_code"`; Sarvam's actual API
     (confirmed against `docs.sarvam.ai`) expects `"language_code"`.
   - It also sends `min_buffer_size` / `max_chunk_length` — Pipecat's own
     internal text-buffering knobs — as if they were part of Sarvam's wire
     protocol. They aren't in Sarvam's documented config schema at all, and
     Sarvam's strict-schema validation rejects the whole message over it.
   Fixed by monkey-patching `SarvamTTSService._send_config` from within
   `bot.py` (see the comment block there) — nothing wrong in our code, this
   corrects a third-party library bug. **Remove the patch once pipecat-ai
   ships a fix.**
7. **`gemini-2.0-flash` (and `-lite`) are retired** — live 404 from the API:
   *"This model ... is no longer available."* Google's own error message
   recommends `gemini-3.6-flash`, but that model **hangs indefinitely** on
   `generate_content` in this account/SDK combo — verified with a trivial
   no-tools "say hi" call that never returned in 30s. `gemini-2.5-flash` is
   confirmed fast (~1.3s) and stable. Fixed: changed the default model in
   both `bot.py` and `agent.py` to `gemini-2.5-flash`.
8. **Windows console can't print Pipecat's startup banner** — it uses Unicode
   box-drawing characters; the default `cp1252` codepage throws
   `UnicodeEncodeError` and crashes `bot.py` before it can start the server.
   Fix (not a code change): run with `PYTHONUTF8=1` set.

### Known but not yet fixed
- **`agent.py` (Part 1, direct `google-genai` SDK path) leaks reasoning text**
  with `gemini-2.5-flash` — a raw `generate_content` call returned internal
  "The user wants X, the next step is Y" commentary *before* the intended
  reply, in the same text output (not a separate "thought" part). This did
  **not** reproduce through `bot.py`'s Pipecat `GoogleLLMService` path (which
  auto-disables "thinking" for 2.5-series models by default per its own
  source) — the live demo's responses were clean. But Part 1 text-mode
  (`agent.py`) may need an explicit `thinking_config` to suppress this now
  that the model changed. Not yet fixed or re-tested against Part 1's exit
  gate.
- **Environment has a system-wide `GOOGLE_API_KEY`** that `google-genai`
  prefers over an explicitly-passed `api_key=` argument (confirmed: even
  scripts passing `api_key=os.environ['GEMINI_API_KEY']` explicitly print
  *"Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY."*).
  The demo worked, so whichever key is active does work — but if you ever
  rotate one and not the other, this is where confusion would come from.

---

## Done

### Part 1 — text brain (pre-existing)
- `catalogue.py`, `tools.py`, `normalise.py`, `system_prompt.txt`, `agent.py`
- Offline test suites pass: `test_normalise.py` (38 cases), `test_tools.py`
  (26 cases) — re-verified this session, still `[ALL PASS]`

### Part 2 — voice pipeline (built and now verified this session)
- `bot.py` — Pipecat pipeline, WebRTC → Sarvam STT → Gemini + 6 tools → Sarvam
  TTS → WebRTC, **actually run and demoed live** (see above)
- `system_prompt.txt` — voice edits (numbers as words, no symbols/SKUs aloud)
- `requirements.txt` — corrected extras and version pin (see bugs #1–2 above)
- `.env.example` / `README.md` — updated to match (webrtc not Daily, correct
  model default, `PYTHONUTF8=1` note)

---

## Left to do

### Immediate
- [ ] Test with a **real microphone** — everything so far used the
      playground's text-input field as an STT bypass. STT itself connects
      successfully but its actual transcription accuracy on real Hindi speech
      is unverified.
- [ ] Decide whether to fix the `agent.py` thinking-leak (see above) before
      relying on Part 1 text mode again.
- [ ] Re-run the Part 1 exit gate (`README.md`) now that the model changed.

### Blocked on things outside the code (per `PART2_PLAN.md`, "Blockers outside the code")
1. **Store visit** — `data/frames.csv` still has 10 placeholder rows using
   *competitor* brand names (Vincent Chase, Lenskart, John Jacobs).
   `data/lenses.csv` conditions need optometrist sign-off. `system_prompt.txt`
   still has two `[FILL IN]` lines (store address, current offer).
2. **Kiosk hardware decision** — far-field mic array. Matters more than
   anything in the codebase for real-world accuracy.
3. If the kiosk deploys on Linux/WSL rather than Windows, **switch back to
   the Daily transport** (`daily-python` has real Linux wheels) — the plan's
   original choice, better suited to a fixed kiosk than a dev-only WebRTC
   page.

### Once real audio + real data exist — `PART2_PLAN.md` Build Order steps 4–5
4. **Latency tuning** — Pipecat metrics already enabled (`enable_metrics=True`
   in `bot.py`); target p50 under 1.5s. Greeting TTFA was 0.53s in this demo,
   a good sign, but that's synthetic-text, not real-conversation, latency.
5. **Kiosk deployment** — process supervision matters: `bot.py`'s STT-drop
   recovery strategy is "end the task and let a supervisor restart it," not
   an in-process reconnect. Needs pm2/systemd or equivalent in production.

### Part 2 exit gate — updated status
- [ ] 10 spoken Hindi conversations end-to-end, no crash — **text-mode
      round trip confirmed working; spoken-audio not yet tested**
- [ ] Time-to-first-audio under 1.5s at p50 — 0.53s on the greeting is
      promising but not a real measurement yet
- [ ] Barge-in works — untested
- [ ] Ambient shop noise doesn't trigger false interruptions — untested
      (needs real mic + real shop noise)
- [x] Prices spoken as words, never digits/symbols — system prompt rule in
      place; not yet observed with an actual price-quoting turn
- [ ] No SKU code ever read aloud — untested
- [ ] Network drop recovers or fails visibly — untested
- [ ] `[WARN] could not parse` count trending to zero — no voice sessions
      logged yet to trend against
- [ ] `leads.json` captures a lead from a fully spoken conversation — still
      doesn't exist; the demo conversation didn't run far enough to reach the
      executive-handoff step

---

## Suggested next step

Get a real microphone in front of `bot.py` (add your Sarvam key, run
`python bot.py` with `PYTHONUTF8=1` set, open `http://localhost:7860`, and
actually talk to it) — that's the one thing this session's text-input demo
couldn't cover, and it's the actual product.
