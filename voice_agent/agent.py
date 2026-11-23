"""
agent.py — Main terminal conversation loop for the Eyenetra voice agent (text mode).

Usage:
    python agent.py

Commands during conversation:
    reset   — Start a new session (clears history)
    quit    — Exit

The agent auto-greets on start and on every reset.
Tool calls are printed to the terminal so you can see what the LLM is doing.
"""

import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

from tools import TOOL_DECLARATIONS, execute_tool

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

load_dotenv()

_API_KEY = os.environ.get("GEMINI_API_KEY")
if not _API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY not found. Copy .env.example to .env and add your key."
    )

# gemini-2.0-flash(-lite) are retired as of this writing (verified live: 404
# from the API). gemini-2.5-flash is confirmed available and fast (~1.3s).
# Note: gemini-3.6-flash also verified available in this account but hangs
# indefinitely on generate_content calls in practice — avoid it for now.
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

SYSTEM_PROMPT = Path(__file__).parent / "system_prompt.txt"
if not SYSTEM_PROMPT.exists():
    raise FileNotFoundError("system_prompt.txt not found next to agent.py")
_system_prompt_text = SYSTEM_PROMPT.read_text(encoding="utf-8")

client = genai.Client(api_key=_API_KEY)

# Build Gemini tool objects from our declarations
_gemini_tools = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(**decl) for decl in TOOL_DECLARATIONS
        ]
    )
]

_config = types.GenerateContentConfig(
    system_instruction=_system_prompt_text,
    tools=_gemini_tools,
    temperature=0.7,
    # Brevity is enforced by the system prompt, not by truncation. A cap this
    # tight was cutting the model off mid-tool-call, which returns a candidate
    # with parts=None and finish_reason=MAX_TOKENS.
    max_output_tokens=400,
    # gemini-2.5-flash leaks internal reasoning ("The customer wants X, so I
    # should ask Y") into the text output on this raw SDK path — verified live.
    # thinking_budget=0 disables it. (bot.py's Pipecat GoogleLLMService already
    # disables thinking for 2.5-series models, so it needs no equivalent.)
    thinking_config=types.ThinkingConfig(thinking_budget=0),
)

# Safety valve: a model that keeps requesting tools would otherwise loop forever,
# burning API quota with no way out.
MAX_TOOL_ROUNDS = 6

# Shown to the customer whenever the model returns nothing usable.
_FALLBACK_REPLY = "Maaf kijiye, main samajh nahi paaya — dobara bata sakte hain?"

# Synthetic message that triggers the opening greeting
_GREETING_TRIGGER = (
    "[System: A new customer has just walked up to the Eyenetra kiosk. "
    "Greet them warmly and naturally — one or two sentences maximum.]"
)


# ---------------------------------------------------------------------------
# Core chat function
# ---------------------------------------------------------------------------

def chat(
    history: list[types.Content],
    user_text: str,
) -> tuple[str, list[types.Content]]:
    """
    Send one user turn to the LLM, handle all tool calls, and return
    (final_text_response, updated_history).

    Tool calls are handled in a loop so the LLM can call multiple tools
    sequentially in a single user turn.
    """
    # Append user message
    history = history + [
        types.Content(role="user", parts=[types.Part(text=user_text)])
    ]

    for _round in range(MAX_TOOL_ROUNDS):
        # One short retry on transient errors — free-tier 429s and "high
        # demand" 503s both resolve within seconds and are common enough that
        # a single retry saves most turns without hurting voice latency.
        response = None
        for attempt in range(2):
            try:
                response = client.models.generate_content(
                    model=MODEL,
                    contents=history,
                    config=_config,
                )
                break
            except Exception as exc:                  # network / quota / 5xx
                print(f"  [api error] {type(exc).__name__}: {exc}")
                if attempt == 0:
                    time.sleep(3)
        if response is None:
            return _FALLBACK_REPLY, history

        # A blocked prompt or a filtered response can come back with no
        # candidates at all — never index [0] blindly.
        if not response.candidates:
            print("  [warn] no candidates returned")
            return _FALLBACK_REPLY, history

        candidate = response.candidates[0]
        model_content = candidate.content

        # parts is None when the model hit MAX_TOKENS or a safety filter.
        # Indexing into it here was the crash.
        if model_content is None or not model_content.parts:
            print(f"  [warn] empty response (finish_reason={candidate.finish_reason})")
            return _FALLBACK_REPLY, history

        # Append the model's response (may contain text AND/OR function calls)
        history = history + [model_content]

        # Collect any function calls from this response
        function_calls = [
            part.function_call
            for part in model_content.parts
            if getattr(part, "function_call", None) is not None
        ]

        if not function_calls:
            # No tool calls — extract and return the final text
            text_parts = [
                part.text
                for part in model_content.parts
                if getattr(part, "text", None)
            ]
            final = " ".join(text_parts).strip()
            return (final or _FALLBACK_REPLY), history

        # Execute each tool call and collect responses
        tool_response_parts: list[types.Part] = []
        for fc in function_calls:
            try:
                result = execute_tool(fc.name, dict(fc.args or {}))
            except Exception as exc:
                # A tool crash must not kill the conversation — hand the error
                # back to the model so it can recover or escalate to staff.
                print(f"  [tool error] {fc.name}: {type(exc).__name__}: {exc}")
                result = {"error": f"{type(exc).__name__}: {exc}"}

            tool_response_parts.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        name=fc.name,
                        response={"result": result},
                    )
                )
            )

        # Append tool results as a user-role message and loop for next LLM call
        history = history + [
            types.Content(role="user", parts=tool_response_parts)
        ]

    # Ran out of tool rounds without the model producing a final answer.
    print(f"  [warn] hit MAX_TOOL_ROUNDS ({MAX_TOOL_ROUNDS}) without a final reply")
    return _FALLBACK_REPLY, history


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    print()
    print("=" * 62)
    print("  Eyenetra Voice Agent — Text Mode")
    print("  Commands: 'reset' = new session | 'quit' / 'exit' = close")
    print(f"  Model: {MODEL}")
    print("=" * 62)
    print()

    history: list[types.Content] = []

    # Auto-greet on start
    greeting, history = chat(history, _GREETING_TRIGGER)
    print(f"Agent: {greeting}\n")

    while True:
        try:
            user_input = input("Customer: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n[Session closed]")
            break

        if not user_input:
            continue

        if user_input.lower() == "reset":
            history = []
            print("\n─── New session ───\n")
            greeting, history = chat(history, _GREETING_TRIGGER)
            print(f"Agent: {greeting}\n")
            continue

        if user_input.lower() in ("quit", "exit"):
            print("\n[Exiting. Goodbye!]")
            break

        response_text, history = chat(history, user_input)
        print(f"\nAgent: {response_text}\n")


if __name__ == "__main__":
    main()
