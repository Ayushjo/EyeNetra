"""
tools.py — Gemini function-calling tool declarations and dispatcher.

Each declaration maps one-to-one with a function in catalogue.py.
The execute_tool() dispatcher is the only place that calls catalogue functions
in response to LLM requests.
"""

import json
from catalogue import (
    search_frames,
    recommend_lens,
    check_stock,
    get_frame_details,
    create_lead,
    resolve_tryon,
)
from normalise import normalize_hindi_number, extract_budget

# ---------------------------------------------------------------------------
# Tool declarations (Gemini FunctionDeclaration schema format)
# ---------------------------------------------------------------------------

TOOL_DECLARATIONS = [
    {
        "name": "search_frames",
        "description": (
            "Search for eyeglass or sunglass frames in the Eyenetra catalogue "
            "based on the customer's preferences and budget. "
            "Always call this before mentioning any frame — never describe frames from memory."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "max_price": {
                    "type": "integer",
                    "description": (
                        "Maximum frame price in INR. "
                        "Convert Hindi number words to digits before calling (use normalise.py)."
                    ),
                },
                "shape": {
                    "type": "string",
                    "description": (
                        "Frame shape preference. "
                        "Valid values: round, rectangular, square, aviator, cat-eye, oval. "
                        "Leave unset if customer has no preference."
                    ),
                },
                "material": {
                    "type": "string",
                    "description": (
                        "Frame material preference. "
                        "Valid values: acetate, metal, titanium, TR90. "
                        "Leave unset if customer has no preference."
                    ),
                },
                "gender": {
                    "type": "string",
                    "description": "Target gender: male, female, or unisex.",
                },
                "frame_type": {
                    "type": "string",
                    "description": "Type of eyewear: 'frame' for eyeglasses, 'sunglass' for sunglasses.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "recommend_lens",
        "description": (
            "Get the correct lens recommendation for a customer based on their screen time, "
            "whether they have an eye prescription, and their age. "
            "Always call this before recommending any lens type — never recommend lenses yourself."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "screen_time_hours": {
                    "type": "integer",
                    "description": (
                        "Customer's combined daily screen time in hours "
                        "(phone + laptop + TV). Ask if not known."
                    ),
                },
                "has_power": {
                    "type": "boolean",
                    "description": (
                        "Whether the customer has an eye prescription (power). "
                        "True if they currently wear glasses or have been prescribed lenses."
                    ),
                },
                "age": {
                    "type": "integer",
                    "description": (
                        "Customer's approximate age in years. "
                        "Ask if not known. Use 30 only if the customer explicitly refuses."
                    ),
                },
            },
            "required": ["screen_time_hours", "has_power", "age"],
        },
    },
    {
        "name": "check_stock",
        "description": "Check whether a specific frame SKU is currently in stock at the store.",
        "parameters": {
            "type": "object",
            "properties": {
                "sku": {
                    "type": "string",
                    "description": "The frame SKU code, e.g. EN-1041.",
                },
            },
            "required": ["sku"],
        },
    },
    {
        "name": "get_frame_details",
        "description": (
            "Get full details for a specific frame SKU, including its price, brand, "
            "material, shape, and stock level. "
            "Always call this before stating any price — never quote prices from memory."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "sku": {
                    "type": "string",
                    "description": "The frame SKU code.",
                },
            },
            "required": ["sku"],
        },
    },
    {
        "name": "create_lead",
        "description": (
            "Save a qualified customer lead after they agree to speak with an executive. "
            "Call ONLY when the customer has explicitly said yes to meeting an executive. "
            "Always collect name and phone before calling."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Customer's name.",
                },
                "phone": {
                    "type": "string",
                    "description": "Customer's 10-digit mobile number.",
                },
                "interest_summary": {
                    "type": "string",
                    "description": (
                        "One-sentence summary of what the customer is looking for, "
                        "e.g. 'power glasses with blue-cut lens, budget under ₹4,000'."
                    ),
                },
                "recommended_frames": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of frame SKUs that were recommended to this customer.",
                },
                "recommended_lens": {
                    "type": "string",
                    "description": "Lens code that was recommended, e.g. BLU-AR-01.",
                },
                "budget": {
                    "type": "string",
                    "description": "Customer's stated budget, e.g. 'under ₹4,000'.",
                },
                "screen_time": {
                    "type": "string",
                    "description": "Customer's daily screen time, e.g. '8-9 hours'.",
                },
            },
            "required": ["name", "phone", "interest_summary"],
        },
    },
    {
        "name": "try_on_frame",
        "description": (
            "Show a frame on the kiosk's virtual try-on screen so the customer "
            "sees it on their own face. Call this whenever you present a frame "
            "the customer wants to see, during the try-on stage of the conversation. "
            "The screen only changes when this tool is called."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "sku": {
                    "type": "string",
                    "description": (
                        "The SKU of the frame to display, e.g. EN-1041. "
                        "Must be a frame returned by search_frames() or "
                        "get_frame_details() — never invent a SKU."
                    ),
                },
            },
            "required": ["sku"],
        },
    },
    {
        "name": "notify_staff",
        "description": (
            "Notify the store staff when the agent cannot help. "
            "Use for: medical eye symptoms, urgent requests, repeated failures, "
            "or anything outside the agent's scope. "
            "After calling this, tell the customer an executive is coming."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Brief reason for the alert, e.g. 'Customer reporting eye pain'.",
                },
            },
            "required": ["reason"],
        },
    },
]


# ---------------------------------------------------------------------------
# Argument coercion
# ---------------------------------------------------------------------------
# The model is instructed to pass integers, but in practice it sometimes passes
# "chaar hazaar", "3k", "₹4,000", "8-9", or "under 3000". Trusting the LLM to do
# arithmetic is exactly the failure mode this project's architecture exists to
# avoid, so every numeric argument is re-parsed in Python before it reaches the
# catalogue. normalise.py is the single source of truth for number parsing.
# ---------------------------------------------------------------------------

def _coerce_int(value, *, budget: bool = False) -> int | None:
    """
    Coerce an LLM-supplied value to an int, or None if it cannot be parsed.

    Args:
        value:  Whatever the model passed — int, float, or a string phrase.
        budget: If True, treat the string as a budget phrase, so ranges like
                "do se teen hazaar" or "under 4000" resolve to the upper bound.
    """
    if value is None:
        return None
    if isinstance(value, bool):          # bool is a subclass of int — reject first
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    if budget:
        _lo, hi = extract_budget(text)
        if hi is not None:
            return hi

    parsed = normalize_hindi_number(text)
    if parsed is not None:
        return parsed

    # Last resort: pull the largest bare number out of the phrase.
    # Handles things like "7-8 hours" → 8, "around 32 years old" → 32.
    import re
    digits = [int(d) for d in re.findall(r"\d+", text.replace(",", ""))]
    return max(digits) if digits else None


def _coerce_bool(value) -> bool:
    """Coerce an LLM-supplied value to a bool. Strings like 'haan'/'yes' count as True."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in (
            "true", "yes", "y", "1", "haan", "ha", "haan ji", "yep", "yeah",
        )
    return False


def _normalise_args(name: str, args: dict) -> dict:
    """Return a copy of args with numeric/boolean fields coerced to real types."""
    clean = dict(args)

    if name == "search_frames":
        if "max_price" in clean:
            coerced = _coerce_int(clean["max_price"], budget=True)
            if coerced is None:
                clean.pop("max_price")       # unparseable → no price filter
            else:
                clean["max_price"] = coerced

    elif name == "recommend_lens":
        screen = _coerce_int(clean.get("screen_time_hours"))
        if screen is None:
            # Loud, not silent: an unparsed screen time flips the lens choice
            # between blue-cut and standard. Add the phrase to normalise.py.
            print(f"  [WARN] could not parse screen_time_hours="
                  f"{clean.get('screen_time_hours')!r} — defaulting to 0")
            screen = 0
        clean["screen_time_hours"] = screen

        age = _coerce_int(clean.get("age"))
        if age is None:
            print(f"  [WARN] could not parse age={clean.get('age')!r} — defaulting to 30")
            age = 30
        clean["age"] = age

        clean["has_power"] = _coerce_bool(clean.get("has_power"))

    elif name == "create_lead":
        frames = clean.get("recommended_frames")
        if isinstance(frames, str):
            clean["recommended_frames"] = [frames]
        elif frames is not None and not isinstance(frames, list):
            clean["recommended_frames"] = []

    # Drop keys the model invented that the catalogue functions don't accept.
    allowed = _ALLOWED_ARGS.get(name)
    if allowed is not None:
        clean = {k: v for k, v in clean.items() if k in allowed}

    return clean


# Parameter whitelist per tool — prevents TypeError from hallucinated kwargs.
_ALLOWED_ARGS: dict[str, set[str]] = {
    "search_frames": {"max_price", "shape", "material", "gender", "frame_type"},
    "recommend_lens": {"screen_time_hours", "has_power", "age"},
    "check_stock": {"sku"},
    "get_frame_details": {"sku"},
    "create_lead": {
        "name", "phone", "interest_summary", "recommended_frames",
        "recommended_lens", "budget", "screen_time",
    },
    "try_on_frame": {"sku"},
    "notify_staff": {"reason"},
}


# ---------------------------------------------------------------------------
# Tool dispatcher
# ---------------------------------------------------------------------------

def execute_tool(name: str, args: dict):
    """
    Execute a tool by name and return its result as a JSON-serialisable value.
    This is the only place catalogue functions are called from agent.py.
    """
    raw = args
    args = _normalise_args(name, args or {})

    if args != raw:
        print(f"  [tool:{name}] args={json.dumps(raw, ensure_ascii=False)}"
              f"  ->  normalised={json.dumps(args, ensure_ascii=False)}")
    else:
        print(f"  [tool:{name}] args={json.dumps(args, ensure_ascii=False)}")

    if name == "search_frames":
        result = search_frames(**args)
        print(f"  -> {len(result)} frame(s) found")
        return result

    elif name == "recommend_lens":
        result = recommend_lens(**args)
        print(f"  -> Recommended: {result.get('name', '?')} ({result.get('lens_code', '?')})")
        return result

    elif name == "check_stock":
        sku = args.get("sku")
        # check_stock() returns False both for "out of stock" and "no such SKU".
        # Disambiguate here so the model never tells a customer a frame we don't
        # carry is merely out of stock.
        if get_frame_details(sku) is None:
            print(f"  -> SKU {sku} not in catalogue")
            return {"error": f"Frame {sku} is not in the catalogue", "sku": sku}
        result = check_stock(**args)
        print(f"  -> In stock: {result}")
        return {"in_stock": result, "sku": sku}

    elif name == "get_frame_details":
        result = get_frame_details(**args)
        if result:
            print(f"  -> Found: {result.get('name')} @ Rs.{result.get('price')}")
        else:
            print(f"  -> SKU not found")
        return result or {"error": f"Frame {args.get('sku')} not found in catalogue"}

    elif name == "try_on_frame":
        sku = args.get("sku", "")
        frame = get_frame_details(sku)
        if frame is None:
            print(f"  -> SKU {sku} not in catalogue")
            return {"error": f"Frame {sku} is not in the catalogue", "sku": sku}
        target = resolve_tryon(sku)
        if target is None:
            print(f"  -> SKU {sku} has no try-on model mapped")
            return {
                "error": f"{frame['name']} is not available on the try-on screen yet — describe it verbally instead",
                "sku": sku,
            }
        # The tryon ids ride back to the browser as a transport app message —
        # bot.py intercepts this result and pushes it over the data channel.
        result = {
            "status": "shown_on_tryon",
            "sku": sku,
            "name": frame["name"],
            "brand": frame["brand"],
            "tryon_frame_id": target["tryon_frame_id"],
            "tryon_variant_id": target["tryon_variant_id"],
        }
        print(f"  -> Try-on: {frame['name']} -> {target['tryon_frame_id']}/{target['tryon_variant_id']}")
        return result

    elif name == "create_lead":
        result = create_lead(**args)
        return result

    elif name == "notify_staff":
        reason = args.get("reason", "")
        print(f"\n[STAFF ALERT] {reason}")
        return {"status": "staff_notified", "reason": reason}

    else:
        print(f"  -> ERROR: unknown tool '{name}'")
        return {"error": f"Unknown tool: {name}"}
