"""
test_flow.py — the KG Optic SOP journey as a state machine, without audio or LLM.

Every path the customer can take is walked here by calling the handlers the
LLM (or fast_intent) would call, and checking the node that follows, what
is spoken, and what is pushed to the kiosk page.

Run with:  .venv/bin/python test_flow.py
"""

import asyncio

import flow as F


class FakeFM:
    def __init__(self):
        self.state = {}
        self.current_node = None


calls = []


def fake_execute(name, args):
    calls.append((name, args))
    if name == "create_lead":
        digits = "".join(c for c in str(args.get("phone", "")) if c.isdigit())
        if len(digits) != 10:
            return {"error": "invalid phone"}
        return {"status": "lead_saved", "phone": digits}
    if name == "try_on_frame":
        return {"status": "shown_on_tryon", "sku": args["sku"], "name": "x", "brand": "y",
                "tryon_frame_id": "f", "tryon_variant_id": "v"}
    return {"status": "ok"}


F.execute_tool = fake_execute
pushed = []


async def push(msg):
    pushed.append(msg)


flow = F.StoreFlow(push)
results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def say_text(node):
    return " ".join(a["text"] for a in node.get("pre_actions", []) if a.get("type") == "tts_say")


def fn_names(node):
    return [f.name for f in node["functions"]]


def stage_of(node):
    return next(a["stage"] for a in node["pre_actions"] if a["type"] == "sync")


def shows(node):
    return [a["sku"] for a in node["pre_actions"] if a["type"] == "show_tryon"]


async def enter(fm, node):
    """What FlowManager does on entering a node: run pre-actions."""
    fm.current_node = node["name"]
    for a in node["pre_actions"]:
        if a["type"] == "sync":
            await flow._sync_action(a, fm)
        elif a["type"] == "show_tryon":
            await flow._show_tryon_action(a, fm)
    return node


async def step(fm, handler, args=None):
    res, node = await handler(args or {}, fm)
    if node is not None:
        await enter(fm, node)
    return res, node


def last_session():
    return next(m for m in reversed(pushed) if m["kind"] == "session")


async def main():
    # ---------------- greet ----------------
    fm = FakeFM()
    g = await enter(fm, flow.greet_node())
    check("greeting is the fixed KG Optic line", say_text(g) == F.GREETING and "KG Optic" in F.GREETING)
    check("greet waits for the customer", g["respond_immediately"] is False)
    check("greet only classifies the need", fn_names(g) == ["record_need"])
    check("greet carries the role", "role_message" in g)
    check("greet syncs stage 'greet' to the kiosk", last_session()["stage"] == "greet")
    check("no frame is shown before the consultation", not any(m["kind"] == "try_on_frame" for m in pushed))

    # ---------------- full power-glasses journey ----------------
    _, n = await step(fm, flow._record_need, {"need": "power"})
    check("power → prescription question", n["name"] == "rx" and say_text(n) == F.ASK_RX)
    check("stage rx synced", last_session()["stage"] == "rx" and last_session()["profile"]["need"] == "power")
    _, n = await step(fm, flow._record_rx, {"status": "old"})
    check("old Rx → free eye test offered", n["name"] == "eye_test_offer" and say_text(n) == F.OFFER_TEST)
    calls.clear()
    _, n = await step(fm, flow._eye_test_choice, {"accept": True})
    check("eye test accepted → staff told", any(c[0] == "notify_staff" for c in calls))
    check("then lifestyle (power question)", n["name"] == "lifestyle" and F.ASK_LIFE["power"] in say_text(n))
    check("profile has eye_test=accepted", fm.state["profile"]["eye_test"] == "accepted")
    _, n = await step(fm, flow._record_lifestyle, {"screen_hours": 9})
    check("near-vision asked once for power customers", n["name"] == "near" and say_text(n) == F.ASK_NEAR)
    _, n = await step(fm, flow._record_near, {"difficulty": False})
    check("→ style (budget + style)", n["name"] == "style" and say_text(n) == F.ASK_STYLE)
    check("still no frame on the face before style is answered", not any(m["kind"] == "try_on_frame" for m in pushed))
    res, n = await step(fm, flow._set_preferences, {"max_price": 5000})
    check("set_preferences → try-on stage", n["name"] == "tryon_0" and stage_of(n) == "tryon")
    s = last_session()
    check("curated set of 3–4 frames", 3 <= len(s["set"]) <= 4)
    check("set is within budget and optical only", all(f["price"] <= 5000 and f["type"] == "frame" for f in s["set"]))
    check("set varies the style (not just price)", len({(f["shape"], f["material"]) for f in s["set"]}) >= 3)
    check("set frames carry 3D ids", all(f["frameId"] and f["variantId"] for f in s["set"]))
    check("first frame pushed to the face", pushed[-1]["kind"] == "try_on_frame" or any(m["kind"] == "try_on_frame" for m in pushed))
    check("intro says how many were chosen", "फ्रेम चुने हैं" in say_text(n) and "पहला" in say_text(n))
    check("asks 'पसंद आया, या अगला दिखाऊँ?'", say_text(n).endswith(F.ASK_NEXT))
    check("try-on node functions", fn_names(n) == ["next_frame", "prev_frame", "show_option", "like_frame",
                                                    "choose_frame", "set_preferences"])
    first = fm.state["set"][0]["sku"]
    _, n = await step(fm, flow._like_frame)
    check("like → shortlist", fm.state["shortlist"][0]["sku"] == first and last_session()["shortlist"] == [first])
    check("like keeps the same frame (no re-show)", shows(n) == [] and "पसंद में जोड़ दिया" in say_text(n))
    check("liked event pushed", any(m["kind"] == "liked" and m["sku"] == first for m in pushed))
    _, n = await step(fm, flow._like_frame)
    check("liking twice does not duplicate", len(fm.state["shortlist"]) == 1)
    _, n = await step(fm, flow._next_frame)
    check("next → option 2 shown", n["name"] == "tryon_1" and shows(n) == [fm.state["set"][1]["sku"]] and "दूसरा" in say_text(n))
    _, n = await step(fm, flow._prev_frame)
    check("prev → option 1", n["name"] == "tryon_0")
    _, n = await step(fm, flow._show_option, {"number": 3})
    check("show_option 3", n["name"] == "tryon_2")
    res, n = await step(fm, flow._show_option, {"number": 9})
    check("show_option out of range → error, stays", n is None and res.get("error"))
    third = fm.state["set"][2]
    _, n = await step(fm, flow._like_frame)
    while fm.current_node != "compare":
        _, n = await step(fm, flow._next_frame)
    check("end of set with 2 liked → compare with one honest recommendation",
          n["name"] == "compare" and "मेरी राय में" in say_text(n) and "क्योंकि" in say_text(n))
    check("recommendation is a shortlisted frame", fm.state["recommended"] in {f["sku"] for f in fm.state["shortlist"]})
    check("9 h screen customer → set includes a light frame", any(f["material"] in F.LIGHT_MATERIALS for f in fm.state["set"]))
    check("screen-heavy customer → light frame recommended when shortlisted",
          (third["material"] in F.LIGHT_MATERIALS or fm.state["set"][0]["material"] in F.LIGHT_MATERIALS)
          <= (next(f for f in fm.state["shortlist"] if f["sku"] == fm.state["recommended"])["material"] in F.LIGHT_MATERIALS))
    res, n = await step(fm, flow._show_shortlisted, {"number": 2})
    check("show_shortlisted puts it on the face, stays in compare", n is None and pushed[-1]["kind"] == "try_on_frame"
          and pushed[-1]["sku"] == fm.state["shortlist"][1]["sku"])
    _, n = await step(fm, flow._choose_frame, {})
    check("choose (no name) in compare = the recommended frame", fm.state["chosen"]["sku"] == fm.state["recommended"])
    check("frame first → lens second", n["name"] == "lens" and stage_of(n) == "lens")
    opts = fm.state["lens_options"]
    check("3 lens options Good/Better/Best, cheapest first",
          [o["tier"] for o in opts] == ["good", "better", "best"] and opts == sorted(opts, key=lambda o: o["price"]))
    check("exactly one recommended lens", sum(o["recommended"] for o in opts) == 1)
    check("9 h screen + power → Blue-Cut AR recommended", next(o for o in opts if o["recommended"])["code"] == "BLU-AR-01")
    check("lens line has price and reason", "₹" not in say_text(n) and "रुपये" in say_text(n) and "आरामदायक" in say_text(n))
    _, n = await step(fm, flow._choose_lens, {"tier": "recommended"})
    total = fm.state["chosen"]["price"] + fm.state["lens"]["price"]
    check("close states frame + lens + total", n["name"] == "close" and "कुल" in say_text(n) and last_session()["total"] == total)
    check("close asks consent with a guest path", "बिना नंबर" in say_text(n))
    check("close functions", fn_names(n) == ["save_contact", "skip_contact"])
    res, n = await step(fm, flow._save_contact, {"name": "राहुल", "phone": "98765"})
    check("invalid phone → stays in close, error returned", n is None and res.get("error"))
    calls.clear()
    res, n = await step(fm, flow._save_contact, {"name": "राहुल", "phone": "9876543210"})
    check("valid contact → lead saved", any(c[0] == "create_lead" for c in calls))
    check("→ handoff to staff for billing", n["name"] == "handoff" and last_session()["handoff"]["reason"] == "billing")
    check("thanks by name", "राहुल जी" in say_text(n))
    check("staff notified", any(c[0] == "notify_staff" for c in calls))
    check("session ended + contact recorded", last_session()["ended"] and last_session()["contact"]["phone"] == "9876543210")
    check("handoff node offers no new actions", fn_names(n) == [])

    # ---------------- sunglasses: no Rx, no lens, guest ----------------
    fm = FakeFM()
    await enter(fm, flow.greet_node())
    _, n = await step(fm, flow._record_need, {"need": "sunglasses"})
    check("sunglasses → lifestyle (sun/driving), no Rx", n["name"] == "lifestyle" and F.ASK_LIFE["sunglasses"] in say_text(n))
    _, n = await step(fm, flow._record_lifestyle, {"outdoor": True})
    check("sunglasses skip the near question", n["name"] == "style")
    _, n = await step(fm, flow._set_preferences, {})
    check("only sunglasses shown", all(f["type"] == "sunglass" for f in last_session()["set"]))
    _, n = await step(fm, flow._choose_frame, {})
    check("sunglasses go straight to close (no lens)", n["name"] == "close" and last_session()["lens"] is None)
    _, n = await step(fm, flow._skip_contact)
    check("guest path → handoff without a lead", n["name"] == "handoff" and last_session()["contact"] == {"guest": True})

    # ---------------- recent Rx skips the eye-test offer ----------------
    fm = FakeFM()
    await enter(fm, flow.greet_node())
    await step(fm, flow._record_need, {"need": "both"})
    _, n = await step(fm, flow._record_rx, {"status": "recent"})
    check("recent Rx → lifestyle with 'show the slip at billing'", n["name"] == "lifestyle" and F.RX_OK in say_text(n))
    _, n = await step(fm, flow._record_rx, {"status": "recent", "symptoms": True})
    check("recent Rx but blur/headache → eye test offered", n["name"] == "eye_test_offer")
    _, n = await step(fm, flow._eye_test_choice, {"accept": False})
    check("declined → power recorded as customer-provided", fm.state["profile"]["rx_source"] == "customer")
    _, n = await step(fm, flow._record_lifestyle, {"screen_hours": 2, "near_difficulty": True})
    check("near already answered → no near question", n["name"] == "style")
    opts, rec = F.lens_options(fm.state["profile"])
    check("near difficulty → progressive recommended", rec == "PROG-01")
    check("progressive reason sets honest adaptation expectations", "आदत" in F.LENS_REASON["PROG-01"])

    # ---------------- shortlist cap + change direction + more ----------------
    fm = FakeFM()
    await enter(fm, flow.greet_node())
    await step(fm, flow._record_need, {"need": "browsing"})
    check("browsing → straight to style with a no-pressure line", fm.current_node == "style")
    await step(fm, flow._set_preferences, {})
    for _ in range(3):
        await step(fm, flow._like_frame)
        await step(fm, flow._next_frame)
    check("3 liked", len(fm.state["shortlist"]) == 3)
    if fm.current_node.startswith("tryon"):
        _, n = await step(fm, flow._like_frame)
        check("4th like → shortlist full → compare", n["name"] == "compare" and F.SHORTLIST_FULL in say_text(n))
    check("shortlist never exceeds 3", len(fm.state["shortlist"]) <= 3)
    _, n = await step(fm, flow._choose_frame, {"number": 2})
    check("choose by number from the shortlist", fm.state["chosen"]["sku"] == fm.state["shortlist"][1]["sku"])

    fm = FakeFM()
    await enter(fm, flow.greet_node())
    await step(fm, flow._record_need, {"need": "power"})
    await step(fm, flow._record_rx, {"status": "recent"})
    await step(fm, flow._record_lifestyle, {})
    await step(fm, flow._record_near, {"difficulty": False})
    await step(fm, flow._set_preferences, {"max_price": 3000})
    first_set = [f["sku"] for f in fm.state["set"]]
    while fm.current_node != "end_of_set":
        await step(fm, flow._next_frame)
    n = {"name": fm.current_node}
    check("end of set with nothing liked → change-direction question", fm.current_node == "end_of_set")
    _, n = await step(fm, flow._more_frames)
    check("more_frames → a new set (unseen first, else same set again)", n["name"] == "tryon_0")
    _, n = await step(fm, flow._set_preferences, {"shape": "round"})
    check("change direction keeps the budget", fm.state["prefs"]["max_price"] == 3000)
    check("round preference honoured first", fm.state["set"][0]["shape"] == "round")
    res, n = await step(fm, flow._set_preferences, {"max_price": 100})
    check("nothing in budget → back to style, says so", n["name"] == "style" and say_text(n) == F.NO_RESULTS)

    # ---------------- handoffs + exits ----------------
    for need, reason in (("service", "service"), ("contact_lens", "contact_lens")):
        fm = FakeFM()
        await enter(fm, flow.greet_node())
        calls.clear()
        _, n = await step(fm, flow._record_need, {"need": need, "detail": "टूट गया"})
        check(f"{need} → staff handoff", n["name"] == "handoff" and last_session()["handoff"]["reason"] == reason
              and any(c[0] == "notify_staff" for c in calls))

    fm = FakeFM()
    await enter(fm, flow.greet_node())
    _, n = await step(fm, flow._record_need, {"need": "eye_test"})
    check("eye test → optometrist told, frames offered meanwhile", n["name"] == "eye_test_wait")
    _, n = await step(fm, flow._see_frames)
    check("see frames while waiting → lifestyle", n["name"] == "lifestyle")

    fm = FakeFM()
    await enter(fm, flow.greet_node())
    await step(fm, flow._record_need, {"need": "power"})
    _, n = await step(fm, flow._talk_to_staff, {"reason": "customer_request"})
    check("talk_to_staff mid-journey → handoff, AI steps back", n["name"] == "handoff" and fn_names(n) == []
          and say_text(n) == F.STAFF_COMING)
    _, n = await step(fm, flow._talk_to_staff, {"reason": "medical", "detail": "आँख लाल"})
    check("medical → optometrist line, never a diagnosis", say_text(n) == F.MEDICAL
          and last_session()["handoff"]["reason"] == "medical")
    n = await enter(fm, flow.handoff_node(fm, "customer_button"))
    check("kiosk button handoff", last_session()["handoff"]["reason"] == "customer_button")

    fm = FakeFM()
    await enter(fm, flow.greet_node())
    await step(fm, flow._record_need, {"need": "browsing"})
    await step(fm, flow._set_preferences, {})
    await step(fm, flow._like_frame)
    _, n = await step(fm, flow._leave_for_now)
    check("leave_for_now → warm exit, shortlist kept", n["name"] == "done" and say_text(n) == F.WARM_EXIT
          and last_session()["shortlist"] and last_session()["ended"])
    _, n = await step(fm, flow._record_need, {"need": "power"})
    check("customer comes back after the exit → journey resumes", n["name"] == "rx")

    # ---------------- touch actions (kiosk taps) ----------------
    fm = FakeFM()
    await enter(fm, flow.greet_node())
    check("snapshot lists allowed actions", last_session()["actions"] == ["record_need"])
    node = await flow.run_action("next_frame", {}, fm)
    check("tap not allowed in this stage → ignored", node is None and fm.current_node == "greet")
    node = await flow.run_action("record_need", {"need": "power"}, fm)
    check("non-touch function can't be called by a tap", node is None)
    await step(fm, flow._record_need, {"need": "browsing"})
    await step(fm, flow._set_preferences, {})
    node = await flow.run_action("next_frame", {}, fm)
    check("tap 'next' in try-on → option 2", node and node["name"] == "tryon_1")
    await enter(fm, node)
    node = await flow.run_action("show_option", {"number": 1}, fm)
    check("tap a frame card → that frame", node and node["name"] == "tryon_0")
    await enter(fm, node)
    node = await flow.run_action("choose_frame", {}, fm)
    check("tap 'यही लूँगा' → close (browsing: no lens)", node and node["name"] == "close")
    await enter(fm, node)
    node = await flow.run_action("skip_contact", {}, fm)
    check("tap 'बिना नंबर' → handoff", node and node["name"] == "handoff")

    globals_ = [f.name for f in flow.global_functions()]
    check("global functions: talk_to_staff + leave_for_now", globals_ == ["talk_to_staff", "leave_for_now"])
    check("no '₹' in any spoken line (TTS reads words)",
          all("₹" not in v for k, v in vars(F).items() if k.isupper() and isinstance(v, str) and k != "ROLE"))

    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    raise SystemExit(1 if failed else 0)


asyncio.run(main())
