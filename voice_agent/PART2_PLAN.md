# Part 2 — Voice Pipeline

Wrapping the Part 1 text brain in real-time speech. Written 17 Aug 2026.

---

## The one thing to get right

**Do not rewrite the agent.** `catalogue.py`, `tools.py`, `normalise.py` and
`system_prompt.txt` are the product. They port to Part 2 unchanged.

The only file that dies is `agent.py` — its hand-rolled `while` loop over
`generate_content()` gets replaced by a Pipecat pipeline. That loop was never the
valuable part; the deterministic catalogue and the number parser are.

```
Part 1                              Part 2
──────                              ──────
agent.py    (chat loop)      →      bot.py  (Pipecat pipeline)   ← REWRITE
tools.py    (declarations)   →      tools.py                     ← keep, re-register
catalogue.py                 →      catalogue.py                 ← unchanged
normalise.py                 →      normalise.py                 ← unchanged, more important
system_prompt.txt            →      system_prompt.txt            ← minor voice edits
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Orchestration | **Pipecat** (`pipecat-ai`) | Handles VAD, barge-in, turn-taking, and the STT→LLM→TTS plumbing. Writing this yourself is months of work. |
| STT | **Sarvam `saarika:v2.5`** | Built for Indian languages. Use `saarika` (transcribe), not `saaras` (translate) — you want Hindi text out of Hindi speech, not English. |
| TTS | **Sarvam `bulbul:v3`** | Natural Hindi/Hinglish. Set the model explicitly — the Pipecat service default is an older version. |
| LLM | **Gemini via `GoogleLLMService`** | Keeps your existing prompt and tool declarations. Sarvam's own `sarvam-105b` is the alternative if you want a single vendor. |
| Transport | **Daily** | WebRTC, works from a browser, easy to test before kiosk hardware exists. |

```bash
pip install "pipecat-ai[daily,google,sarvam,silero]" python-dotenv loguru
```

Keys needed in `.env`: `GEMINI_API_KEY` (have), `SARVAM_API_KEY`, `DAILY_API_KEY`.
Your `.env.example` already lists all three.

---

## Architecture

```
Customer speaks
      ↓
DailyTransport (WebRTC in)
      ↓
SarvamSTTService          saarika:v2.5, language_code="hi-IN"
      ↓
LLMContextAggregator      (user side)
      ↓
GoogleLLMService          gemini-2.0-flash + your 6 tool declarations
      ↓  ↑
      └──┴─ function handlers → tools.execute_tool() → catalogue.py
      ↓
SarvamTTSService          bulbul:v3
      ↓
DailyTransport (WebRTC out)
      ↓
Customer hears
```

The `↓ ↑` loop is the same tool round-trip `agent.py` does today — Pipecat just
runs it for you instead of your `for _round in range(MAX_TOOL_ROUNDS)`.

---

## Porting the tools

Pipecat registers handlers per function name. Your dispatcher becomes the body:

```python
from tools import TOOL_DECLARATIONS, execute_tool

llm = GoogleLLMService(
    api_key=os.getenv("GEMINI_API_KEY"),
    model="gemini-2.0-flash",
    tools=ToolsSchema(standard_tools=[...]),   # built from TOOL_DECLARATIONS
)

async def handle(params):
    result = execute_tool(params.function_name, params.arguments)
    await params.result_callback(result)

for decl in TOOL_DECLARATIONS:
    llm.register_function(decl["name"], handle)
```

One adapter function. That's the whole port. Everything downstream —
the coercion layer, the whitelist, the lens decision tree — runs untouched.

---

## Why `normalise.py` matters more in Part 2

In text mode a customer types `4000`. In voice mode, Sarvam hands you whatever
was said: *"chaar hazaar"*, *"chaar hazar ke aas paas"*, *"चार हज़ार"*, or a
mis-heard *"char hazar"*. The LLM then passes that string straight into
`search_frames(max_price=...)`.

The coercion layer added in `tools.py` is what stops that becoming a wrong price
filter. **Every new spelling variant you hear in voice testing goes into
`_UNIT_WORDS` in `normalise.py`, with a case added to `test_tools.py`.** Budget an
hour a week for this for the first month — it is the single highest-leverage
maintenance task in the project.

Watch the terminal for `[WARN] could not parse ...` lines. Each one is a phrase
your parser is missing.

---

## Production settings (from Sarvam's Pipecat guide — use these, don't rediscover)

These are non-obvious and each one costs a day if you get it wrong:

- **Do not add Silero VAD on top of Sarvam.** Sarvam does server-side VAD. Two
  VADs disagreeing about the same audio produces phantom interruptions.
- **Turn strategy:** use `ExternalUserTurnStartStrategy` / `ExternalUserTurnStopStrategy`
  with a 0.2–0.3 s timeout. Pipecat's default smart-turn model expects VAD frames
  Sarvam never emits, so the default silently adds latency.
- **`MinWordsUserTurnStartStrategy(min_words=2..3)`** with `should_interrupt=False`
  — critical for a kiosk in a noisy Raipur shop, where ambient chatter will
  otherwise constantly barge in on the agent.
- **TTS `min_buffer_size`:** drop from the default 50 to 15–25 characters. This is
  the biggest single win on time-to-first-audio.
- **`user_turn_stop_timeout`:** 2.5–3.0 s. Your system prompt already says "Indian
  speakers often pause mid-sentence" — this is the knob that actually enforces it.
- **`user_idle_timeout`:** 8–15 s, wired to the SILENCE behaviour already in your
  system prompt.
- **STT has no working auto-reconnect** despite `reconnect_on_error=True`. Handle
  `on_connection_error` and rebuild the service yourself, or the kiosk goes deaf
  after the first network blip and nobody notices.
- **Align TTS sample rate with the transport** to avoid per-chunk resampling.

Target: **under 1.5 s** from customer stopping speech to first audio out. Past
about 2 s people repeat themselves, which corrupts the turn.

---

## System prompt changes for voice

Small but necessary:

- Numerals must be spoken, not written. `₹1,200` reads badly through TTS — instead
  instruct "bara sau rupaye". Add a rule: *write prices as words, not digits.*
- Kill every remaining symbol: `₹`, `—`, `•`, and SKU codes like `EN-1001`. Never
  read a SKU aloud; describe the frame by name and brand.
- The 2-sentence cap gets stricter, not looser. Aloud, 2 sentences is already long.
- Drop the `[System: A new customer has just walked up...]` greeting trigger; in
  Pipecat you queue an opening `TTSSpeakFrame` on participant-join instead.

---

## Build order

1. **Hello-world pipeline** — Daily room, Sarvam STT → echo the transcript → Sarvam
   TTS. No LLM. Confirms keys, audio, and that Hindi transcribes correctly.
2. **Add Gemini, no tools.** Confirms language mirroring survives the STT→TTS round
   trip. This is where you find out if the prompt's Hinglish rules still hold when
   the input is transcribed rather than typed.
3. **Register the tools.** Now `catalogue.py` is live over voice. Re-run the logic
   of your 12 `test_conversation.py` scenarios — spoken, by a human.
4. **Tune latency** with the numbers above. Measure, don't guess: enable Pipecat
   metrics for time-to-first-audio.
5. **Kiosk hardware** — mic, speaker, always-on browser, network failure behaviour.

Steps 1–3 are about a week. Step 4 is where the time actually goes.

---

## Exit gate for Part 2

- [ ] 10 spoken Hindi conversations end-to-end, no crash
- [ ] Time-to-first-audio measured and under 1.5 s at p50
- [ ] Barge-in works: customer can interrupt mid-sentence
- [ ] Ambient shop noise does NOT trigger false interruptions
- [ ] Prices spoken as words, never as digits or symbols
- [ ] No SKU code ever read aloud
- [ ] Network drop mid-conversation recovers or fails visibly — never silently deaf
- [ ] `[WARN] could not parse` count trending to zero across test sessions
- [ ] `leads.json` captures a lead from a fully spoken conversation

---

## Blockers outside the code

These gate launch regardless of engineering progress:

1. **Store visit** — real `frames.csv` (the current 10 rows are placeholders using
   competitor brand names), real lens rules from the optometrist, and the
   `[FILL IN]` address and current-offer lines in `system_prompt.txt`.
2. **Sarvam + Daily API keys.**
3. **Kiosk hardware decision** — a far-field mic array matters more than anything
   in this document for real-world accuracy. A bad mic makes a perfect pipeline
   useless.

Start #1 and #3 now; they have lead times that the code does not.

---

Sources: [Sarvam × Pipecat voice agent guide](https://docs.sarvam.ai/api/integration/build-voice-agent-with-pipecat) ·
[Sarvam Pipecat production guide](https://docs.sarvam.ai/api/integration/pipecat-production-guide) ·
[Pipecat Sarvam STT reference](https://docs.pipecat.ai/api-reference/server/services/stt/sarvam) ·
[Pipecat Google LLM reference](https://docs.pipecat.ai/api-reference/server/services/llm/google)
