"""
flow.py — the KG Optic kiosk conversation as a Pipecat Flows state machine.

It follows the store SOP ("Customer Journey SOP & AI Conversation Blueprint
— Simplified Edition"): the AI kiosk supports the same simple journey as
staff, and never shows the customer their own face before it has
understood them.

  greet ─record_need─┬─ power / both / child ─▶ rx ─record_rx──▶ (eye_test_offer) ─▶ lifestyle ─▶ (near) ─▶ style
                     ├─ sunglasses ─────────────────────────────────────────────────▶ lifestyle ─────────▶ style
                     ├─ browsing ──────────────────────────────────────────────────────────────────────────▶ style
                     ├─ eye_test ─▶ eye_test_wait ─(frames meanwhile)─▶ lifestyle
                     └─ service / contact lens ─▶ handoff (staff)

  style ─set_preferences─▶ tryon[i]  (3–4 curated frames; mirror switches on here, not before)
  tryon ─next/prev/show_option─▶ tryon[j]     ─like_frame─▶ shortlist (2–3)
        ─choose_frame─▶ lens (Good / Better / Best) ─choose_lens─▶ close
        └ end of set ─▶ compare (one honest recommendation) / change direction
  close ─save_contact | skip_contact (guest path)─▶ handoff (billing + measurements by staff)

  Anywhere: talk_to_staff ─▶ handoff (the AI stops; staff take over)
            leave_for_now ─▶ warm exit with the shortlist saved

Everything the customer must hear identically (greeting, frame
announcements, lens advice, the close, the exit) is a fixed `tts_say` line
built here in Python. The LLM only classifies answers into function calls
and answers short questions from facts given in the node.

After every change a full "session" snapshot is pushed to the kiosk page
(RTVI server message): the page renders the stage, the consultation card,
the frame set, the lens options and the handoff from it, and reports it to
the staff dashboard.
"""

from typing import Any, Awaitable, Callable

from loguru import logger

from catalogue import _lenses as LENSES
from catalogue import recommend_lens, resolve_tryon, search_frames
from pipecat.flows import FlowManager, FlowsFunctionSchema, NodeConfig
from speech_text import rupees
from tools import _normalise_args, execute_tool

STORE = "KG Optic"
ASSISTANT = "आरव"

# ---------------------------------------------------------------------------
# Fixed lines (Devanagari Hindi; brand / product words in English script, as
# Sarvam's TTS best practices recommend). Male voice ("shubh") → male verbs.
# ---------------------------------------------------------------------------
GREETING = (
    f"नमस्ते जी, {STORE} में आपका स्वागत है! मैं {ASSISTANT} हूँ, चश्मा चुनने में आपकी मदद करूँगा। "
    "आज किस चीज़ के लिए देख रहे हैं — पावर का चश्मा, sunglasses, या दोनों?"
)
ASK_RX = "ठीक है। आपके पास latest पावर का नंबर है? आख़िरी बार आँखों की जाँच कब करवाई थी?"
RX_OK = "बढ़िया, पर्ची बिलिंग के समय स्टाफ़ को दिखा दीजिएगा।"
OFFER_TEST = "कोई बात नहीं — हमारे यहाँ आँखों की जाँच मुफ़्त होती है, बस कुछ मिनट लगते हैं। फ्रेम चुनने के बाद जाँच करवा लें?"
TEST_YES = "ठीक है, मैंने जाँच नोट कर ली है।"
TEST_NO = "जैसा आप चाहें।"
EYE_TEST_WAIT = (
    "ज़रूर! हमारे यहाँ आँखों की जाँच मुफ़्त होती है, मैंने optometrist को बता दिया है। "
    "तब तक आपके लिए फ्रेम भी देख लें?"
)
ASK_LIFE = {
    "power": "आप दिन में स्क्रीन पर कितना समय बिताते हैं, और क्या धूप में या रात में गाड़ी ज़्यादा चलाते हैं?",
    "sunglasses": "धूप में ज़्यादा रहते हैं, या ड्राइविंग के लिए चाहिए?",
    "child": "बच्चे की उम्र कितनी है, और क्या वे खेल-कूद ज़्यादा करते हैं?",
}
ASK_NEAR = "और क्या पास का पढ़ने में — जैसे मोबाइल या अख़बार — कोई दिक़्क़त होती है?"
ASK_STYLE = "अब फ्रेम चुनते हैं। बजट लगभग कितना रखें, और कोई पसंदीदा स्टाइल — जैसे गोल, चौकोर, या हल्का फ्रेम?"
BROWSING = "बिल्कुल जी, आराम से देखिए। कोई बजट या पसंदीदा स्टाइल हो तो बताइए, वरना मैं कुछ अच्छे फ्रेम दिखा देता हूँ।"
SET_INTRO = "आपके लिए {n} फ्रेम चुने हैं। अब स्क्रीन पर देखिए, आप पर पहनाकर दिखा रहा हूँ।"
RELAXED = "उस स्टाइल में अभी फ्रेम नहीं हैं, इसलिए आपके बजट के सबसे करीब वाले चुने हैं।"
FRAME_LINE = "{ordinal} है {brand} का {name}, {price}।"
ASK_NEXT = "पसंद आया, या अगला दिखाऊँ?"
LIKED = "{name} आपकी पसंद में जोड़ दिया। अगला देखें, या इसे फ़ाइनल करें?"
SHORTLIST_FULL = "आपकी पसंद में तीन फ्रेम हो गए हैं।"
NO_RESULTS = "इस बजट में अभी कोई फ्रेम नहीं है। बजट थोड़ा बढ़ाएँ, या कोई और स्टाइल देखें?"
END_NONE = "ये थे इस स्टाइल के फ्रेम। कोई और शेप, रंग या मटीरियल देखें, या कुछ और फ्रेम दिखाऊँ?"
END_ONE = "ये थे सारे फ्रेम। आपकी पसंद में {name} है — इसे फ़ाइनल करें, या कुछ और देखें?"
COMPARE = "आपकी पसंद में {k} फ्रेम हैं। मेरी राय में {rec} आप पर सबसे अच्छा रहेगा, क्योंकि {reason}। इसे फ़ाइनल करें, या दूसरा?"
LENS_INTRO = "बढ़िया चुनाव! अब लेंस। आपकी ज़रूरत के हिसाब से मेरी सलाह है {name}, {price} — {reason}।"
LENS_ASK = "स्क्रीन पर तीनों विकल्प हैं, कौन-सा लें?"
CLOSE = (
    "तो फ़ाइनल करते हैं — {items}, कुल {total}। नाप और बिलिंग हमारे स्टाफ़ करेंगे। "
    "बिल WhatsApp पर भेजने के लिए अपना नाम और मोबाइल नंबर बता दीजिए — या चाहें तो बिना नंबर के भी आगे बढ़ सकते हैं।"
)
BILLING_NAMED = "धन्यवाद {name} जी! हमारे स्टाफ़ बस आ रहे हैं, नाप और बिलिंग वही करेंगे।"
BILLING_GUEST = "कोई बात नहीं जी। हमारे स्टाफ़ बस आ रहे हैं, नाप और बिलिंग वही करेंगे।"
STAFF_COMING = "ज़रूर जी, मैंने हमारे स्टाफ़ को बुला दिया है। वे बस एक मिनट में आपके पास होंगे।"
SERVICE = "जी, इसमें हमारे स्टाफ़ आपकी मदद करेंगे। मैंने उन्हें बुला दिया है, बस एक मिनट।"
MEDICAL = "आँखों की तकलीफ़ में हमारे optometrist ही सही बताएँगे। मैंने उन्हें बुला दिया है, बस एक मिनट।"
WARM_EXIT = "बिल्कुल जी, मैंने आपकी पसंद नोट कर ली है। आप आराम से decide कीजिए — जब भी ready हों, हम यहीं हैं।"

ORDINALS = ["पहला", "दूसरा", "तीसरा", "चौथा"]
SET_SIZE = 4
SHORTLIST_MAX = 3

ROLE = f"""You are {ASSISTANT}, the kiosk assistant of {STORE}, an optical showroom in Raipur. You talk to customers out loud through text-to-speech, like a helpful optical consultant.

Rules:
- Reply in conversational Hindi written in Devanagari script. Write brand names and English product words (frame, lens, sunglasses, aviator) in English letters. Never write Hindi in Roman letters.
- At most two short sentences. No lists, markdown or emojis. You are male: use male verb forms (करता हूँ, दिखाता हूँ).
- Never invent prices, discounts, offers, delivery dates, stock, policies or medical claims. State only facts given in the current task or returned by a function.
- Discounts or offers: say our staff will tell the store's current offers at billing. Never promise one.
- Eye pain, redness, sudden blurred vision, injury or any medical symptom: call talk_to_staff with reason "medical". Never diagnose.
- The customer wants a human / staff member, has a complaint, or a bulk/corporate enquiry: call talk_to_staff.
- The customer wants to leave or think it over ("सोच के बताऊँगा", "बाद में आऊँगा"): call leave_for_now.
- Act, don't interview: when the customer's words answer the current step even partly, call the step's function right away with what you have. Ask a question only when their words give nothing for the step.
- If what you heard is unclear or not addressed to you (other people talking), briefly ask them to repeat. Do not guess.
- Fixed lines (greeting, frame announcements, questions) are spoken by the system already; do not repeat them."""

SHAPES = ["round", "rectangular", "square", "aviator", "cat-eye", "oval"]
LIGHT_MATERIALS = ("TR90", "titanium")

# Sends one UI event to the kiosk page (RTVI server message):
#   session {...snapshot}                       — after every change
#   try_on_frame {sku, name, brand, frameId, variantId, price, shape, index, total}
PushUI = Callable[[dict], Awaitable[None]]


def _say(text: str) -> dict:
    return {"type": "tts_say", "text": text}


def _sync(stage: str) -> dict:
    return {"type": "sync", "stage": stage}


def _frame_facts(f: dict) -> str:
    return (
        f"{f['brand']} {f['name']}: price {f['price']} rupees, shape {f['shape']}, "
        f"material {f['material']}, for {f['gender']}, {'in stock' if f.get('stock', 0) > 0 else 'out of stock'}."
    )


def _ui_frame(f: dict) -> dict:
    t = resolve_tryon(f["sku"]) or {}
    return {
        "sku": f["sku"], "name": f["name"], "brand": f["brand"], "price": f["price"],
        "shape": f["shape"], "material": f["material"], "type": f.get("type"),
        "frameId": t.get("tryon_frame_id"), "variantId": t.get("tryon_variant_id"),
    }


# ---------------------------------------------------------------------------
# Catalogue logic (pure functions — unit-tested)
# ---------------------------------------------------------------------------
def find_frames(prefs: dict) -> tuple[list[dict], bool]:
    """Every in-stock match that has a 3D model, cheapest first. Relaxes
    material, then shape, then gender if nothing matches; the budget and the
    frame type are never relaxed. Returns (frames, relaxed)."""
    search = {k: v for k, v in prefs.items() if k in ("frame_type", "max_price", "shape", "material", "gender")}
    args = _normalise_args("search_frames", {k: v for k, v in search.items() if v not in (None, "")})
    attempts = [args]
    for drop in ("material", "shape", "gender"):
        if args.get(drop):
            attempts.append({k: v for k, v in attempts[-1].items() if k != drop})
    for i, attempt in enumerate(attempts):
        frames = [f for f in search_frames(**attempt, limit=None) if resolve_tryon(f["sku"])]
        if frames:
            return frames, i > 0
    return [], False


def curate(prefs: dict, exclude: set[str] = frozenset(), include_light: bool = False) -> tuple[list[dict], bool]:
    """SOP stage 5: 3–4 relevant frames, varied in shape/material rather
    than just price. Light-weight wish puts TR90/titanium first;
    include_light (long screen days) guarantees one light frame in the set."""
    frames, relaxed = find_frames(prefs)
    frames = [f for f in frames if f["sku"] not in exclude]
    if prefs.get("light"):
        frames.sort(key=lambda f: (f["material"] not in LIGHT_MATERIALS, f["price"]))
    picked: list[dict] = []
    seen_styles: set[tuple] = set()
    for f in frames:  # first pass: one per shape/material
        key = (f["shape"], f["material"])
        if key not in seen_styles:
            picked.append(f)
            seen_styles.add(key)
        if len(picked) == SET_SIZE:
            break
    for f in frames:  # fill up
        if len(picked) == SET_SIZE:
            break
        if f not in picked:
            picked.append(f)
    if include_light and picked and not any(f["material"] in LIGHT_MATERIALS for f in picked):
        light = next((f for f in frames if f["material"] in LIGHT_MATERIALS), None)
        if light:
            picked[-1 if len(picked) == SET_SIZE else len(picked):] = [light]
    return picked, relaxed


LENS_REASON = {
    "STD-SV-01": "साफ़ और भरोसेमंद बेसिक लेंस",
    "AR-01": "रोशनी और स्क्रीन की चमक कम करता है",
    "BLU-AR-01": "स्क्रीन पर ज़्यादा समय के लिए आरामदायक है",
    "BLU-ZERO-01": "बिना पावर के स्क्रीन के लिए आरामदायक है",
    "PROG-01": "दूर और पास दोनों के लिए एक ही लेंस, बस शुरू में कुछ दिन आदत लगती है",
    "PHOTO-01": "धूप में अपने आप गहरा हो जाता है",
}
TIERS = ["good", "better", "best"]


def lens_options(profile: dict) -> tuple[list[dict], str]:
    """Good / Better / Best for the customer's use, cheapest first, and the
    recommended lens code (catalogue.recommend_lens + outdoor use)."""
    has_power = profile.get("need") in ("power", "both", "child", "eye_test") or profile.get("rx") in ("recent", "old")
    near = bool(profile.get("near_difficulty"))
    screen = int(profile.get("screen_hours") or 0)
    outdoor = bool(profile.get("outdoor") or profile.get("driving"))
    rec = recommend_lens(screen_time_hours=screen, has_power=has_power, age=45 if near else 30)["lens_code"]
    if outdoor and has_power and rec in ("AR-01", "STD-SV-01"):
        rec = "PHOTO-01"
    by_code = {l["lens_code"]: l for l in LENSES}
    if has_power:
        pool = ["AR-01", "BLU-AR-01", "PHOTO-01", "PROG-01"] if near else ["STD-SV-01", "AR-01", "BLU-AR-01", "PHOTO-01"]
    else:
        pool = ["STD-SV-01", "BLU-ZERO-01", "AR-01"]
    pool = [c for c in pool if c in by_code]
    # Keep the recommendation, then the nearest-priced others → 3 options.
    others = sorted((c for c in pool if c != rec), key=lambda c: abs(int(by_code[c]["price"]) - int(by_code[rec]["price"])))
    chosen = sorted([rec, *others[:2]], key=lambda c: int(by_code[c]["price"]))
    options = []
    for tier, code in zip(TIERS, chosen):
        l = by_code[code]
        options.append({
            "code": code, "name": l["name"], "price": int(l["price"]), "tier": tier,
            "description": l["description"], "reason": LENS_REASON.get(code, ""), "recommended": code == rec,
        })
    return options, rec


def recommend_frame(shortlist: list[dict], profile: dict) -> tuple[dict, str]:
    """One honest recommendation with a simple reason (SOP stage 6), from
    facts only: light material for long screen days, the stated shape,
    then the stated budget."""
    prefs = profile.get("prefs", {})
    if int(profile.get("screen_hours") or 0) >= 6 or prefs.get("light"):
        for f in shortlist:
            if f["material"] in LIGHT_MATERIALS:
                return f, "यह हल्का है, पूरे दिन पहनने में आरामदायक रहेगा"
    if prefs.get("shape"):
        for f in shortlist:
            if f["shape"] == prefs["shape"]:
                return f, "यह आपकी पसंद की शेप में है"
    best = min(shortlist, key=lambda f: f["price"])
    return best, "यह आपके बजट में सबसे अच्छी कीमत वाला है"


class StoreFlow:
    """Builds the nodes; handlers are bound methods (args, flow_manager)."""

    def __init__(self, push_ui: PushUI | None):
        self._push_ui = push_ui

    # -- wiring ------------------------------------------------------------
    def register(self, flow_manager: FlowManager) -> None:
        flow_manager.register_action("show_tryon", self._show_tryon_action)
        flow_manager.register_action("sync", self._sync_action)

    def global_functions(self) -> list[FlowsFunctionSchema]:
        return [
            FlowsFunctionSchema(
                name="talk_to_staff",
                description=(
                    "Hand the customer to a human staff member and stop the AI. Use when they ask for a "
                    "person/staff, for medical eye symptoms, complaints, or bulk/corporate enquiries."
                ),
                properties={
                    "reason": {"type": "string", "enum": ["customer_request", "medical", "complaint", "bulk", "other"]},
                    "detail": {"type": "string", "description": "Short note for the staff."},
                },
                required=["reason"],
                handler=self._talk_to_staff,
            ),
            FlowsFunctionSchema(
                name="leave_for_now",
                description="The customer wants to leave or think it over and decide later.",
                properties={},
                required=[],
                handler=self._leave_for_now,
            ),
        ]

    # -- session state -----------------------------------------------------
    @staticmethod
    def _st(fm: FlowManager) -> dict:
        st = fm.state
        st.setdefault("profile", {})
        st.setdefault("set", [])
        st.setdefault("seen", [])
        st.setdefault("shortlist", [])
        return st

    def snapshot(self, fm: FlowManager) -> dict:
        st = self._st(fm)
        frame = st.get("chosen")
        lens = st.get("lens")
        total = (frame["price"] if frame else 0) + (lens["price"] if lens else 0)
        return {
            "kind": "session",
            "stage": st.get("stage", "greet"),
            "profile": {**st["profile"], **({"prefs": st.get("prefs")} if st.get("prefs") else {})},
            "set": [_ui_frame(f) for f in st["set"]],
            "current": st.get("idx"),
            "shortlist": [f["sku"] for f in st["shortlist"]],
            "recommended": st.get("recommended"),
            "chosen": frame["sku"] if frame else None,
            "lenses": st.get("lens_options", []),
            "lens": lens["code"] if lens else None,
            "total": total or None,
            "contact": st.get("contact"),
            "handoff": st.get("handoff"),
            "ended": st.get("stage") in ("handoff", "done"),
        }

    async def _sync_action(self, action: dict, flow_manager: FlowManager) -> None:
        st = self._st(flow_manager)
        st["stage"] = action.get("stage", st.get("stage"))
        await self._event(self.snapshot(flow_manager))

    async def _show_tryon_action(self, action: dict, flow_manager: FlowManager) -> None:
        sku = action.get("sku", "")
        result = execute_tool("try_on_frame", {"sku": sku})
        if isinstance(result, dict) and result.get("status") == "shown_on_tryon":
            await self._event({
                "kind": "try_on_frame",
                "sku": result["sku"],
                "name": result["name"],
                "brand": result["brand"],
                "frameId": result["tryon_frame_id"],
                "variantId": result["tryon_variant_id"],
                **{k: action[k] for k in ("price", "shape", "index", "total") if k in action},
            })
        else:
            logger.warning(f"show_tryon: {sku} could not be shown: {result}")

    async def _event(self, msg: dict) -> None:
        """UI-only event; never let a closed data channel break the flow."""
        if self._push_ui is None:
            return
        try:
            await self._push_ui(msg)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"UI event {msg.get('kind')} not delivered: {e}")

    def _fn(self, name: str, description: str, handler, properties: dict | None = None,
            required: list[str] | None = None) -> FlowsFunctionSchema:
        return FlowsFunctionSchema(name=name, description=description, properties=properties or {},
                                   required=required or [], handler=handler)

    @staticmethod
    def _node(name: str, stage: str, task: str, functions: list, say: str | None = None,
              extra_pre: list | None = None, role: bool = False) -> NodeConfig:
        node: dict = {
            "name": name,
            "task_messages": [{"role": "developer", "content": task}],
            "pre_actions": [_sync(stage), *(extra_pre or []), *([_say(say)] if say else [])],
            "respond_immediately": False,
            "functions": functions,
        }
        if role:
            node["role_message"] = ROLE
        return node

    # -- 1. welcome + need -------------------------------------------------
    def greet_node(self, speak: bool = True) -> NodeConfig:
        return self._node(
            "greet", "greet",
            "The customer is saying what they came for. Call record_need with the best match: "
            "power (prescription glasses / chashma / frames), sunglasses, both, eye_test, child (glasses for a "
            "child), service (repair, loose/tight fitting, adjustment, pickup, warranty), contact_lens, or browsing (just "
            "looking). 'number/power wale glasses', 'nazar ka chashma', 'frame chahiye' = power. 'bas dekh raha hoon', 'aise hi', 'just looking' = browsing (call it, don't ask what they like). Call record_need "
            "immediately; ask one short question only if you cannot tell at all.",
            [self._record_need_fn()],
            say=GREETING if speak else None, role=True,
        )

    def _record_need_fn(self) -> FlowsFunctionSchema:
        return self._fn(
            "record_need", "Record what the customer came for.", self._record_need,
            {
                "need": {"type": "string", "enum": ["power", "sunglasses", "both", "eye_test", "child",
                                                    "service", "contact_lens", "browsing"]},
                "detail": {"type": "string", "description": "Anything else they said (budget, style, problem)."},
            },
            ["need"],
        )

    async def _record_need(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        need = args.get("need") or "browsing"
        st["profile"]["need"] = need
        if args.get("detail"):
            st["profile"]["need_detail"] = args["detail"]
        logger.info(f"flow: need={need} detail={args.get('detail')!r}")
        if need in ("power", "both", "child"):
            return None, self.rx_node()
        if need == "sunglasses":
            return None, self._lifestyle(flow_manager)
        if need == "eye_test":
            st["profile"]["eye_test"] = "requested"
            execute_tool("notify_staff", {"reason": "Eye test requested"})
            return None, self.eye_test_wait_node()
        if need in ("service", "contact_lens"):
            reason = "service" if need == "service" else "contact_lens"
            return None, self._handoff(flow_manager, reason, args.get("detail"), SERVICE)
        return None, self.style_node(BROWSING)

    def eye_test_wait_node(self) -> NodeConfig:
        return self._node(
            "eye_test_wait", "rx",
            "The optometrist was told about the eye test. If the customer wants to see frames meanwhile "
            "(yes / ok / dikhao) → see_frames. If not → talk_to_staff with reason customer_request.",
            [self._fn("see_frames", "Customer wants to look at frames while waiting.", self._see_frames)],
            say=EYE_TEST_WAIT,
        )

    async def _see_frames(self, args: dict, flow_manager: FlowManager):
        self._st(flow_manager)["profile"]["need"] = "power"
        return None, self._lifestyle(flow_manager)

    # -- 3. prescription ---------------------------------------------------
    def rx_node(self) -> NodeConfig:
        return self._node(
            "rx", "rx",
            "The customer is telling whether they have a recent prescription. Call record_rx: status recent "
            "(test within about a year, or they have the latest number), old (older), none (never / no "
            "prescription), unsure. symptoms=true if they mention headache, blur or difficulty seeing.",
            [self._fn("record_rx", "Record the prescription status.", self._record_rx, {
                "status": {"type": "string", "enum": ["recent", "old", "none", "unsure"]},
                "symptoms": {"type": "boolean"},
            }, ["status"])],
            say=ASK_RX,
        )

    async def _record_rx(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        status = args.get("status") or "unsure"
        st["profile"]["rx"] = status
        if args.get("symptoms"):
            st["profile"]["symptoms"] = True
        if status == "recent" and not args.get("symptoms"):
            return None, self._lifestyle(flow_manager, lead=RX_OK)
        return None, self._node(
            "eye_test_offer", "rx",
            "A free eye test was offered. Yes → eye_test_choice accept=true. No → accept=false.",
            [self._fn("eye_test_choice", "Customer's answer to the free eye test offer.", self._eye_test_choice,
                      {"accept": {"type": "boolean"}}, ["accept"])],
            say=OFFER_TEST,
        )

    async def _eye_test_choice(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        accept = bool(args.get("accept"))
        st["profile"]["eye_test"] = "accepted" if accept else "declined"
        if accept:
            execute_tool("notify_staff", {"reason": "Eye test after frame selection"})
        else:
            st["profile"]["rx_source"] = "customer"  # SOP: record that power was customer-provided
        return None, self._lifestyle(flow_manager, lead=TEST_YES if accept else TEST_NO)

    # -- 4. lifestyle ------------------------------------------------------
    def _lifestyle(self, fm: FlowManager, lead: str = "") -> NodeConfig:
        need = self._st(fm)["profile"].get("need")
        kind = "sunglasses" if need == "sunglasses" else "child" if need == "child" else "power"
        return self._node(
            "lifestyle", "lifestyle",
            "The customer is describing daily use. Call record_lifestyle with whatever they said: "
            "screen_hours (number, hours per day on screens), outdoor (lots of sun / outdoor work), "
            "driving (drives often, especially at night), sports, child_age, near_difficulty (trouble "
            "reading phone/newspaper up close). Unknown fields: omit. 'for driving' = driving true; 'sun/dhoop' = "
            "outdoor true. Call record_lifestyle immediately with whatever they said — never ask a follow-up.",
            [self._fn("record_lifestyle", "Record daily-use answers.", self._record_lifestyle, {
                "screen_hours": {"type": "integer"},
                "outdoor": {"type": "boolean"},
                "driving": {"type": "boolean"},
                "sports": {"type": "boolean"},
                "child_age": {"type": "integer"},
                "near_difficulty": {"type": "boolean"},
            })],
            say=f"{lead} {ASK_LIFE[kind]}".strip(),
        )

    async def _record_lifestyle(self, args: dict, flow_manager: FlowManager):
        p = self._st(flow_manager)["profile"]
        for k in ("screen_hours", "outdoor", "driving", "sports", "child_age", "near_difficulty"):
            if args.get(k) not in (None, ""):
                p[k] = args[k]
        if p.get("need") in ("power", "both") and "near_difficulty" not in p:
            return None, self._node(
                "near", "lifestyle",
                "Call record_near: difficulty=true if they have trouble reading up close, else false.",
                [self._fn("record_near", "Near-vision difficulty.", self._record_near,
                          {"difficulty": {"type": "boolean"}}, ["difficulty"])],
                say=ASK_NEAR,
            )
        return None, self.style_node()

    async def _record_near(self, args: dict, flow_manager: FlowManager):
        self._st(flow_manager)["profile"]["near_difficulty"] = bool(args.get("difficulty"))
        return None, self.style_node()

    # -- 5. style + curation -----------------------------------------------
    def style_node(self, line: str = ASK_STYLE) -> NodeConfig:
        return self._node(
            "style", "style",
            "Collect budget (maximum price in rupees) and optional style. "
            f"Shapes: {', '.join(SHAPES)}. light=true for light-weight frames. As soon as you know the budget, "
            "or they say anything / no limit / 'aap hi dikha do' / 'kuch accha', call set_preferences right away with "
            "everything known (it may be empty). Never ask about the budget again if they skipped it.",
            [self._set_preferences_fn()],
            say=line,
        )

    def _set_preferences_fn(self) -> FlowsFunctionSchema:
        return self._fn(
            "set_preferences",
            "Pick a new curated set of frames from budget/style (also to change direction: other shape, "
            "colour, material, or a lower budget when they say it is expensive).",
            self._set_preferences,
            {
                "max_price": {"type": "integer", "description": "Budget in rupees; omit if no limit."},
                "shape": {"type": "string", "enum": SHAPES},
                "material": {"type": "string", "enum": ["acetate", "metal", "titanium", "TR90"]},
                "gender": {"type": "string", "enum": ["male", "female", "unisex"]},
                "light": {"type": "boolean", "description": "Wants a light-weight frame."},
            },
        )

    async def _set_preferences(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        need = st["profile"].get("need")
        base = {"frame_type": "sunglass" if need == "sunglasses" else "frame" if need in ("power", "both", "child") else None}
        prefs = {**base, **st.get("prefs", {}), **{k: v for k, v in args.items() if v not in (None, "")}}
        prefs = {k: v for k, v in prefs.items() if v not in (None, "")}
        st["prefs"] = prefs
        frames, relaxed = curate(prefs, include_light=int(st["profile"].get("screen_hours") or 0) >= 6)
        logger.info(f"flow: prefs={prefs} → {[f['sku'] for f in frames]} relaxed={relaxed}")
        if not frames:
            return {"found": 0}, self.style_node(NO_RESULTS)
        return {"found": len(frames)}, self._start_set(flow_manager, frames, relaxed)

    def _start_set(self, fm: FlowManager, frames: list[dict], relaxed: bool = False) -> NodeConfig:
        st = self._st(fm)
        st["set"] = frames
        st["idx"] = 0
        st["seen"] = list(dict.fromkeys([*st["seen"], *(f["sku"] for f in frames)]))
        intro = SET_INTRO.format(n=_count(len(frames)))
        if relaxed:
            intro = f"{RELAXED} {intro}"
        return self._tryon(fm, 0, intro=intro)

    # -- 6. try-on + shortlist ---------------------------------------------
    def _tryon(self, fm: FlowManager, idx: int, intro: str = "", line: str | None = None,
               show: bool = True) -> NodeConfig:
        st = self._st(fm)
        frames = st["set"]
        st["idx"] = idx
        f = frames[idx]
        if line is None:
            ordinal = ORDINALS[idx] if idx < len(ORDINALS) else "अगला"
            line = f"{intro} {FRAME_LINE.format(ordinal=ordinal, brand=f['brand'], name=f['name'], price=rupees(f['price']))} {ASK_NEXT}".strip()
        shortlist = ", ".join(x["name"] for x in st["shortlist"]) or "none yet"
        options = "; ".join(f"{i + 1}. {x['brand']} {x['name']} ₹{x['price']}" for i, x in enumerate(frames))
        pre = [{"type": "show_tryon", "sku": f["sku"], "price": f["price"], "shape": f["shape"],
                "index": idx, "total": len(frames)}] if show else []
        return self._node(
            f"tryon_{idx}", "tryon",
            f"The customer sees this frame on their face: {_frame_facts(f)} It is option {idx + 1} of "
            f"{len(frames)} ({options}). Shortlist: {shortlist}.\n"
            "next → next_frame. previous / pichla → prev_frame. A specific option by number or name → "
            "show_option. They like it / add to shortlist → like_frame. They want THIS one / final / yahi "
            "lunga → choose_frame. Other shape, colour, material, light-weight → set_preferences. 'Mehenga hai' / "
            f"too expensive → set_preferences with max_price {max(f['price'] - 1, 0)} right away, no question. "
            f"'Sab same lag rahe hain' / all look alike → set_preferences with a shape other than {f['shape']}. "
            "Questions about this frame: answer in one short sentence from the facts above only.",
            [
                self._fn("next_frame", "Show the next frame of the set.", self._next_frame),
                self._fn("prev_frame", "Show the previous frame.", self._prev_frame),
                self._fn("show_option", "Show a specific option of the set.", self._show_option,
                         {"number": {"type": "integer", "description": "1-based option number"},
                          "name": {"type": "string"}}),
                self._fn("like_frame", "Add the frame on the face to the shortlist.", self._like_frame),
                self._fn("choose_frame", "The customer decides on the frame on the face.", self._choose_frame),
                self._set_preferences_fn(),
            ],
            say=line, extra_pre=pre,
        )

    async def _next_frame(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        idx = st.get("idx", 0) + 1
        if idx >= len(st["set"]):
            return None, self._end_of_set(flow_manager)
        return None, self._tryon(flow_manager, idx)

    async def _prev_frame(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        return None, self._tryon(flow_manager, max(0, st.get("idx", 0) - 1))

    def _find_in(self, frames: list[dict], args: dict) -> int | None:
        n = args.get("number")
        if isinstance(n, int) and 1 <= n <= len(frames):
            return n - 1
        name = (args.get("name") or "").strip().lower()
        if name:
            for i, f in enumerate(frames):
                if name in f["name"].lower() or f["name"].lower() in name or name in f["brand"].lower():
                    return i
        return None

    async def _show_option(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        i = self._find_in(st["set"], args)
        if i is None:
            return {"error": "no such option"}, None
        return None, self._tryon(flow_manager, i)

    async def _like_frame(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        f = st["set"][st.get("idx", 0)]
        if all(x["sku"] != f["sku"] for x in st["shortlist"]):
            if len(st["shortlist"]) >= SHORTLIST_MAX:
                return None, self._compare(flow_manager, lead=SHORTLIST_FULL)
            st["shortlist"].append(f)
        await self._event({"kind": "liked", "sku": f["sku"]})
        return None, self._tryon(flow_manager, st["idx"], line=LIKED.format(name=f["name"]), show=False)

    def _end_of_set(self, fm: FlowManager) -> NodeConfig:
        st = self._st(fm)
        sl = st["shortlist"]
        if len(sl) >= 2:
            return self._compare(fm)
        if len(sl) == 1:
            line = END_ONE.format(name=sl[0]["name"])
        else:
            line = END_NONE
        return self._node(
            "end_of_set", "tryon",
            f"All {len(st['set'])} frames of this set were shown. Shortlist: {', '.join(x['name'] for x in sl) or 'empty'}. "
            "Finalise the shortlisted frame → choose_frame (name optional). Different shape/colour/material/budget → "
            "set_preferences. More frames like these → more_frames. See one again → show_option.",
            [
                self._fn("choose_frame", "Finalise a frame (from the shortlist, by name, or the one on the face).",
                         self._choose_frame, {"name": {"type": "string"}, "number": {"type": "integer"}}),
                self._fn("more_frames", "Show more frames with the same preferences.", self._more_frames),
                self._fn("show_option", "Show a specific option of the set again.", self._show_option,
                         {"number": {"type": "integer"}, "name": {"type": "string"}}),
                self._set_preferences_fn(),
            ],
            say=line,
        )

    async def _more_frames(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        frames, _ = curate(st.get("prefs", {}), exclude=set(st["seen"]))
        if not frames:
            # Everything matching was seen — start the same set again.
            st["seen"] = []
            frames, _ = curate(st.get("prefs", {}))
        return None, self._start_set(flow_manager, frames)

    def _compare(self, fm: FlowManager, lead: str = "") -> NodeConfig:
        st = self._st(fm)
        sl = st["shortlist"]
        rec, reason = recommend_frame(sl, {**st["profile"], "prefs": st.get("prefs", {})})
        st["recommended"] = rec["sku"]
        names = "; ".join(f"{i + 1}. {f['brand']} {f['name']} ₹{f['price']}" for i, f in enumerate(sl))
        line = COMPARE.format(k=_count(len(sl)), rec=rec["name"], reason=reason)
        return self._node(
            "compare", "compare",
            f"Shortlist: {names}. Recommended: {rec['name']}. The customer picks the final frame → choose_frame "
            "with its name or number (no name = the recommended one). To see one on the face again → "
            "show_shortlisted. Other frames → set_preferences.",
            [
                self._fn("choose_frame", "Finalise one shortlisted frame.", self._choose_frame,
                         {"name": {"type": "string"}, "number": {"type": "integer"}}),
                self._fn("show_shortlisted", "Put a shortlisted frame on the face to compare.", self._show_shortlisted,
                         {"name": {"type": "string"}, "number": {"type": "integer"}}),
                self._set_preferences_fn(),
            ],
            say=f"{lead} {line}".strip(),
        )

    async def _show_shortlisted(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        i = self._find_in(st["shortlist"], args)
        f = st["shortlist"][i if i is not None else 0]
        if f not in st["set"]:
            st["set"] = [*st["set"], f]
        idx = st["set"].index(f)
        st["idx"] = idx
        await self._show_tryon_action({"sku": f["sku"], "price": f["price"], "shape": f["shape"],
                                       "index": idx, "total": len(st["set"])}, flow_manager)
        return {"showing": f["name"]}, None

    async def _choose_frame(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        f = None
        if args.get("name") or args.get("number"):
            in_list = flow_manager.current_node in ("compare", "end_of_set") and st["shortlist"]
            pool = st["shortlist"] if in_list else st["set"]
            i = self._find_in(pool, args)
            if i is None and pool is not st["set"]:
                i = self._find_in(st["set"], args)
                pool = st["set"]
            f = pool[i] if i is not None else None
        if f is None:
            if flow_manager.current_node == "compare":
                f = next((x for x in st["shortlist"] if x["sku"] == st.get("recommended")), st["shortlist"][0])
            elif flow_manager.current_node == "end_of_set" and st["shortlist"]:
                f = st["shortlist"][0]
            else:
                f = st["set"][st.get("idx", 0)]
        st["chosen"] = f
        if all(x["sku"] != f["sku"] for x in st["shortlist"]):
            st["shortlist"].append(f)
        logger.info(f"flow: chosen {f['sku']}")
        if f.get("type") == "sunglass" or st["profile"].get("need") in ("sunglasses", "browsing"):
            st["lens"] = None
            return None, self._close(flow_manager, lead="बढ़िया चुनाव!")
        return None, self._lens(flow_manager)

    # -- 7. lens -----------------------------------------------------------
    def _lens(self, fm: FlowManager) -> NodeConfig:
        st = self._st(fm)
        options, rec = lens_options(st["profile"])
        st["lens_options"] = options
        r = next(o for o in options if o["code"] == rec)
        facts = "; ".join(f"{o['tier']}: {o['name']} ₹{o['price']} ({o['description']})" for o in options)
        return self._node(
            "lens", "lens",
            f"Lens options for the chosen frame: {facts}. Recommended: {r['name']}. The customer picks one → "
            "choose_lens with its tier (good / better / best) or code; 'jo aap kahein' / yes = the recommended "
            "one; cheapest / sasta = good; best / sabse accha = best; blue cut → its code. Call choose_lens right "
            "away, never confirm first. Questions (even 'does it cure/treat eyes?'): answer in one short "
            "sentence — lenses help comfort and clear vision, no medical claims — do not call talk_to_staff "
            "unless they describe an eye symptom.",
            [self._fn("choose_lens", "Customer's lens choice.", self._choose_lens, {
                "tier": {"type": "string", "enum": ["good", "better", "best", "recommended"]},
                "code": {"type": "string", "enum": [o["code"] for o in options]},
            })],
            say=f"{LENS_INTRO.format(name=r['name'], price=rupees(r['price']), reason=r['reason'])} {LENS_ASK}",
        )

    async def _choose_lens(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        options = st.get("lens_options", [])
        pick = None
        if args.get("code"):
            pick = next((o for o in options if o["code"] == args["code"]), None)
        if pick is None and args.get("tier") in TIERS:
            pick = next((o for o in options if o["tier"] == args["tier"]), None)
        if pick is None:
            pick = next(o for o in options if o["recommended"])
        st["lens"] = pick
        return None, self._close(flow_manager)

    # -- 8. close: consent + guest path → staff for billing ------------------
    def _close(self, fm: FlowManager, lead: str = "") -> NodeConfig:
        st = self._st(fm)
        f, lens = st["chosen"], st.get("lens")
        total = f["price"] + (lens["price"] if lens else 0)
        items = f"{f['brand']} का {f['name']}" + (f" के साथ {lens['name']} लेंस" if lens else "")
        return self._node(
            "close", "close",
            "Ask for name and 10-digit mobile number (for the bill on WhatsApp). They may refuse — that is fine. "
            "Name and number given → save_contact. Any refusal ('nahi', 'number rehne dijiye', 'aise hi', guest, "
            "bina number) → skip_contact immediately. If they give only the name, ask for the number once; if "
            "they still don't, skip_contact.",
            [
                self._fn("save_contact", "Save name and mobile number (customer agreed).", self._save_contact,
                         {"name": {"type": "string"}, "phone": {"type": "string"}}, ["name", "phone"]),
                self._fn("skip_contact", "Customer continues as a guest without sharing details.", self._skip_contact),
            ],
            say=f"{lead} {CLOSE.format(items=items, total=rupees(total))}".strip(),
        )

    async def _save_contact(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        f, lens = st["chosen"], st.get("lens")
        result = execute_tool("create_lead", {
            "name": args.get("name", ""),
            "phone": args.get("phone", ""),
            "interest_summary": f"Chose {f['brand']} {f['name']} ({f['sku']})" + (f" + {lens['name']}" if lens else ""),
            "recommended_frames": [x["sku"] for x in st["shortlist"]],
            "budget": f"under ₹{st['prefs']['max_price']}" if st.get("prefs", {}).get("max_price") else None,
        })
        if isinstance(result, dict) and result.get("error"):
            return result, None  # invalid phone → the LLM asks again
        name = str(args.get("name", "")).strip()
        st["contact"] = {"name": name, "phone": result.get("phone", args.get("phone")) if isinstance(result, dict) else args.get("phone")}
        return None, self._handoff(flow_manager, "billing", None, BILLING_NAMED.format(name=name or ""))

    async def _skip_contact(self, args: dict, flow_manager: FlowManager):
        self._st(flow_manager)["contact"] = {"guest": True}
        return None, self._handoff(flow_manager, "billing", None, BILLING_GUEST)

    # -- handoff + exits -----------------------------------------------------
    def _handoff(self, fm: FlowManager, reason: str, detail: str | None, line: str) -> NodeConfig:
        st = self._st(fm)
        st["handoff"] = {"reason": reason, **({"detail": detail} if detail else {})}
        execute_tool("notify_staff", {"reason": f"{reason}{': ' + detail if detail else ''}"})
        logger.info(f"flow: handoff reason={reason} detail={detail!r}")
        return self._node(
            "handoff", "handoff",
            "A staff member is on the way and the AI is stepping back. If the customer speaks, reply in one "
            "short sentence that staff are coming. Do not start anything new.",
            [],
            say=line,
        )

    def handoff_node(self, fm: FlowManager, reason: str = "customer_request") -> NodeConfig:
        """From outside the conversation (the kiosk's 'call staff' button)."""
        return self._handoff(fm, reason, None, STAFF_COMING)

    async def _talk_to_staff(self, args: dict, flow_manager: FlowManager):
        reason = args.get("reason") or "customer_request"
        line = MEDICAL if reason == "medical" else STAFF_COMING
        return None, self._handoff(flow_manager, reason, args.get("detail"), line)

    async def _leave_for_now(self, args: dict, flow_manager: FlowManager):
        st = self._st(flow_manager)
        if st["shortlist"]:
            execute_tool("notify_staff", {"reason": "Customer left to think it over (shortlist saved)"})
        return None, self._node(
            "done", "done",
            "The customer is leaving. If they speak again and want to continue, call record_need.",
            [self._record_need_fn()],
            say=WARM_EXIT,
        )


def _count(n: int) -> str:
    return {1: "एक", 2: "दो", 3: "तीन", 4: "चार"}.get(n, str(n))


def state_summary(state: dict[str, Any]) -> str:
    """Compact one-line state for logs."""
    return (f"stage={state.get('stage')} profile={state.get('profile')} idx={state.get('idx')} "
            f"set={[f['sku'] for f in state.get('set', [])]} shortlist={[f['sku'] for f in state.get('shortlist', [])]}")
