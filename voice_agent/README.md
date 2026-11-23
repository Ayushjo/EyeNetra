# Eyenetra Voice Agent — Part 1: Text Brain

Voice assistant for the Eyenetra optical store, Raipur.  
This is **Part 1** — the text-only conversation loop. No voice, no UI yet.

---

## Project structure

```
voice_agent/
├── .env.example           ← Copy to .env and fill your API keys
├── requirements.txt
├── data/
│   ├── frames.csv         ← Replace with real store catalogue after Part 0
│   ├── lenses.csv         ← Replace conditions after meeting the optometrist
│   └── tryon_map.csv      ← SKU → try-on app frame/variant ids (Part 3)
├── catalogue.py           ← Business logic — pure Python, no LLM
├── tools.py               ← Gemini tool declarations + coercion + dispatcher
├── system_prompt.txt      ← Edit this file to tune agent personality
├── agent.py               ← Main chat loop (run this)
├── normalise.py           ← Hindi/English number parser
├── test_normalise.py      ← Unit tests for the number parser
├── test_tools.py          ← Tests for arg coercion + the lens decision table
├── test_conversation.py   ← Adversarial scenario tests (needs API key)
└── PART2_PLAN.md          ← Voice pipeline architecture
```

---

## How numbers are handled

The LLM is *told* to pass integers, but it doesn't always. `tools.py` re-parses
every numeric argument through `normalise.py` before it reaches `catalogue.py`,
so `"chaar hazaar"`, `"3k"`, `"7-8 hours"` and `"do se teen hazaar"` all arrive
as real ints. Number parsing is Python's job, never the LLM's.

If you see `[WARN] could not parse ...` in the terminal, the parser is missing a
phrase. Add it to `_UNIT_WORDS` in `normalise.py` and add a case to
`test_tools.py`. This is the main ongoing maintenance task, and it matters far
more once voice input arrives in Part 2.

---

## Quick start

### 1. Create a virtual environment

```powershell
cd "c:\Users\HP\OneDrive\Desktop\New folder\voice_agent"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Add your API key

```powershell
copy .env.example .env
# Then open .env and paste your GEMINI_API_KEY
```

Get a free Gemini key at [aistudio.google.com](https://aistudio.google.com).

### 3. Run the offline tests (no API key needed)

```powershell
python test_normalise.py   # number parser — 44 cases
python test_tools.py       # arg coercion + lens decision table — 26 cases
```

Both must print `[ALL PASS]` before you run anything that costs API credits.

### 4. Run the agent

```powershell
python agent.py
```

Type as a customer. The agent auto-greets. Commands:
- `reset` — start a new session
- `quit` / `exit` — close

### 5. Run adversarial tests

```powershell
# Run all 12 scenarios (makes real API calls)
python test_conversation.py

# Run a single scenario (e.g. scenario 4 — medical symptom)
python test_conversation.py 4
```

---

## Before you go to Part 2

Work through the Part 1 **exit gate** from the plan:

- [ ] Full 8-turn Hinglish conversation works correctly
- [ ] Frames recommended are within budget (tool-verified, not hallucinated)
- [ ] Lens recommendation comes from `recommend_lens()`, not the LLM's guess
- [ ] Off-topic questions (iPhone, free product) handled gracefully
- [ ] Medical symptoms trigger `notify_staff()`, not advice
- [ ] Hindi number words normalised correctly
- [ ] `create_lead()` saves to `leads.json`
- [ ] No response exceeds ~2 sentences

Run 20 manual test conversations. Every one should feel like a competent shop assistant.

---

## Tuning tips

| Problem | Fix |
|---|---|
| Agent invents prices | Strengthen "NEVER state a price from memory" rule in `system_prompt.txt` |
| Agent talks too much | Lower `max_output_tokens` in `agent.py` or add stricter length rule to prompt |
| Wrong language mirroring | Add more examples to the EXAMPLES section of `system_prompt.txt` |
| Bad lens recommendation | Fix the if/else tree in `catalogue.py` → `recommend_lens()` |
| Number words not parsed | Add the phrase pattern to `normalise.py` and test with `test_normalise.py` |

---

## Model

Default: `gemini-2.5-flash`. `gemini-2.0-flash(-lite)` are retired (confirmed
live — the API 404s). Google's own error message points to `gemini-3.6-flash`,
but that model hangs indefinitely on `generate_content` in practice (verified
live, even with no tools and a trivial prompt) — avoid it for now.
Override with `GEMINI_MODEL=...` in `.env` if this changes again.

---

## Part 2 — voice pipeline

`bot.py` is the Pipecat voice pipeline described in `PART2_PLAN.md`, **verified
working end-to-end** (WebRTC connect → STT → Gemini + tools → TTS → audio out —
see `STATUS.md` for the full test log). It reuses `catalogue.py`, `tools.py`,
and `normalise.py` unchanged, and `system_prompt.txt` with the voice edits
(numbers spoken as words, no symbols/SKUs read aloud) already applied.

```powershell
pip install -r requirements.txt
# add SARVAM_API_KEY to .env (GEMINI_API_KEY already required)
python bot.py
```

Open `http://localhost:7860` in a browser and click Connect. Uses Pipecat's
built-in WebRTC transport, not Daily — `daily-python` has no Windows wheels, so
it can't install here. See `STATUS.md` for the full list of bugs found and
fixed to get this running (a pipecat-ai TTS config bug, the retired Gemini
model, the Windows transport swap). Follow the build order and
production-tuning notes in `PART2_PLAN.md` — steps 1–3 there are done; step 4
(latency tuning against real audio) and step 5 (kiosk hardware) are still open.

**Windows note:** run with `PYTHONUTF8=1` set (or `$env:PYTHONUTF8=1` in
PowerShell) — Pipecat's startup banner uses Unicode box-drawing characters that
crash on the default `cp1252` console codepage otherwise.
