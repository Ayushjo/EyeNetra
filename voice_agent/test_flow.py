"""
test_flow.py — the store conversation's state machine, without audio or LLM.

Run with:  .venv/bin/python test_flow.py
"""

import asyncio

import flow as F


class FakeFM:
    def __init__(self):
        self.state = {}


calls = []


def fake_execute(name, args):
    calls.append((name, args))
    if name == "create_lead":
        return {"status": "lead_saved"}
    if name == "try_on_frame":
        return {"status": "shown_on_tryon", "sku": args["sku"], "name": "x", "brand": "y",
                "tryon_frame_id": "f", "tryon_variant_id": "v"}
    return {"status": "ok"}


F.execute_tool = fake_execute
pushed = []


async def push(msg):
    pushed.append(msg)


flow = F.StoreFlow(push)
fm = FakeFM()
results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


def say_text(node):
    return " ".join(a["text"] for a in node.get("pre_actions", []) if a.get("type") == "tts_say")


def fn_names(node):
    return [f.name for f in node["functions"]]


async def main():
    g = flow.greet_node()
    check("greeting is the fixed line", say_text(g) == F.GREETING)
    check("greet waits for the customer", g["respond_immediately"] is False)
    check("greet only classifies the need", fn_names(g) == ["record_need"])

    _, n = await flow._record_need({"need": "sunglasses"}, fm)
    check("sunglasses → prefs node with fixed question", n["name"] == "prefs" and say_text(n) == F.ASK_PREFS)
    check("frame_type recorded", fm.state["prefs"]["frame_type"] == "sunglass")

    _, n = await flow._record_need({"need": "eye_test"}, fm)
    check("eye test → staff notified + fixed line", calls[-1][0] == "notify_staff" and say_text(n) == F.EYE_TEST)

    _, n = await flow._record_need({"need": "eyeglasses"}, fm)
    res, show = await flow._set_preferences({"max_price": 3000}, fm)
    frames = fm.state["frames"]
    check("search found try-on-able frames within budget", res["found"] > 0 and all(f["price"] <= 3000 for f in frames))
    check("frames cheapest first", [f["price"] for f in frames] == sorted(f["price"] for f in frames))
    acts = show["pre_actions"]
    check("show node: try-on action BEFORE the spoken line", acts[0]["type"] == "show_tryon" and acts[1]["type"] == "tts_say")
    check("show node asks the fixed next question", say_text(show).endswith(F.ASK_NEXT))
    check("price spoken in Devanagari words, no digits", not any(ch.isdigit() for ch in say_text(show)))
    check("show node tools", fn_names(show) == ["next_frame", "like_frame", "set_preferences", "finish"])

    await flow._show_tryon_action(acts[0], fm)
    check("try-on pushed to the browser", pushed[-1]["kind"] == "try_on_frame" and pushed[-1]["sku"] == frames[0]["sku"])
    check("try-on event carries price, shape, position",
          pushed[-1]["price"] == frames[0]["price"] and pushed[-1]["shape"] == frames[0]["shape"]
          and pushed[-1]["index"] == 0 and pushed[-1]["total"] == len(frames))

    # Walk to the end of the list.
    node = show
    for i in range(1, len(frames)):
        _, node = await flow._next_frame({}, fm)
        check(f"next_frame → frame {i}", node["name"] == f"show_{i}")
    _, node = await flow._next_frame({}, fm)
    check("past the last frame → end_of_list", node["name"] == "end_of_list" and say_text(node) == F.END_OF_LIST)
    _, node = await flow._show_again({}, fm)
    check("show_again → first frame", node["name"] == "show_0")

    _, liked = await flow._like_frame({}, fm)
    check("like → 'liked' UI event for the frame on the face", pushed[-1] == {"kind": "liked", "sku": frames[0]["sku"]})
    check("like → liked with executive offer", liked["name"] == "liked" and "executive" in say_text(liked))
    _, lead = await flow._wants_executive({}, fm)
    check("executive → lead asks name", say_text(lead) == F.ASK_NAME)
    _, bye = await flow._save_contact({"name": "Ravi", "phone": "9876543210"}, fm)
    lead_call = [c for c in calls if c[0] == "create_lead"][-1][1]
    check("lead saved with liked frame", "Liked" in lead_call["interest_summary"] and lead_call["phone"] == "9876543210")
    check("lead → goodbye with fixed line", bye["name"] == "goodbye" and say_text(bye) == F.LEAD_DONE)
    check("lead saved → session_end UI event", pushed[-1] == {"kind": "session_end"})

    res, node = await flow._set_preferences({"max_price": 10}, fm)
    check("nothing in budget → fixed no-results line, stay in prefs", res["found"] == 0 and say_text(node) == F.NO_RESULTS)

    fm.state["prefs"] = {}
    res, node = await flow._set_preferences({"max_price": 5000, "shape": "hexagon-nonexistent"}, fm)
    check("impossible shape → relaxed with fixed explanation", res["found"] > 0 and say_text(node).startswith(F.RELAXED))

    # Same inputs → identical lines (determinism).
    a = say_text(flow.show_node(frames, 0))
    b = say_text(flow.show_node(frames, 0))
    check("identical inputs give identical spoken text", a == b)


asyncio.run(main())
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
raise SystemExit(1 if failed else 0)
