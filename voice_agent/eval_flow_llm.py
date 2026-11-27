"""
eval_flow_llm.py — does the production LLM pick the right action at every
stage of the SOP journey?

Builds the real flow nodes (flow.py) by walking the real handlers, sends each
customer utterance with exactly the tools and instructions that node offers
(plus the global talk_to_staff / leave_for_now), and checks the function
call and its key arguments. Same model and endpoint as bot.py
(SARVAM_LLM_MODEL, default sarvam-105b-conversations).

Usage: .venv/bin/python eval_flow_llm.py [--repeat 2] [--only rx,lens]
"""

import argparse
import asyncio
import json
import os
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
import flow as F  # noqa: E402

F.execute_tool = lambda name, args: (
    {"status": "lead_saved", "phone": re.sub(r"\D", "", str(args.get("phone")))} if name == "create_lead"
    else {"status": "shown_on_tryon", "sku": args.get("sku"), "name": "", "brand": "",
          "tryon_frame_id": "f", "tryon_variant_id": "v"} if name == "try_on_frame"
    else {"status": "ok"}
)
MODEL = os.environ.get("SARVAM_LLM_MODEL", "sarvam-105b-conversations")
KEY = os.environ["SARVAM_API_KEY"]


class FM:
    def __init__(self):
        self.state = {}
        self.current_node = None


async def build_nodes() -> dict:
    sf = F.StoreFlow(None)
    nodes = {}

    async def go(fm, handler, args=None):
        _, n = await handler(args or {}, fm)
        if n is not None:
            fm.current_node = n["name"]
            for a in n["pre_actions"]:
                if a["type"] == "sync":
                    fm.state["stage"] = a["stage"]
        return n

    fm = FM()
    nodes["greet"] = sf.greet_node()
    nodes["rx"] = await go(fm, sf._record_need, {"need": "power"})
    nodes["eye_test_offer"] = await go(fm, sf._record_rx, {"status": "old"})
    nodes["lifestyle"] = await go(fm, sf._eye_test_choice, {"accept": True})
    nodes["near"] = await go(fm, sf._record_lifestyle, {"screen_hours": 8})
    nodes["style"] = await go(fm, sf._record_near, {"difficulty": False})
    nodes["tryon"] = await go(fm, sf._set_preferences, {"max_price": 5000})
    await go(fm, sf._like_frame)
    await go(fm, sf._next_frame)
    await go(fm, sf._like_frame)
    while fm.current_node != "compare":
        await go(fm, sf._next_frame)
    nodes["compare"] = await go(fm, sf._next_frame) if fm.current_node != "compare" else sf._compare(fm)
    nodes["lens"] = await go(fm, sf._choose_frame, {})
    nodes["close"] = await go(fm, sf._choose_lens, {"choice": "recommended"})
    nodes["set"] = [f["name"] for f in fm.state["set"]]
    nodes["shortlist"] = [f["name"] for f in fm.state["shortlist"]]

    fm2 = FM()
    nodes["sun_lifestyle"] = await go(fm2, sf._record_need, {"need": "sunglasses"})
    fm3 = FM()
    await go(fm3, sf._record_need, {"need": "power"})
    await go(fm3, sf._record_rx, {"status": "recent"})
    await go(fm3, sf._record_lifestyle, {})
    await go(fm3, sf._record_near, {"difficulty": False})
    await go(fm3, sf._set_preferences, {"max_price": 3000})
    while fm3.current_node != "end_of_set":
        await go(fm3, sf._next_frame)
    nodes["end_of_set"] = await go(fm3, sf._next_frame) if fm3.current_node != "end_of_set" else None
    if nodes["end_of_set"] is None:
        nodes["end_of_set"] = sf._end_of_set(fm3)
    nodes["eye_test_wait"] = await go(FM(), sf._record_need, {"need": "eye_test"})
    return nodes


# (node, utterance, expected function, expected args subset)
CASES = [
    # greet — SOP stage 2
    ("greet", "मुझे नज़र का चश्मा बनवाना है।", "record_need", {"need": "power"}),
    ("greet", "पावर वाला चश्मा चाहिए", "record_need", {"need": "power"}),
    ("greet", "number wale glasses dikhao", "record_need", {"need": "power"}),
    ("greet", "धूप का चश्मा दिखाइए", "record_need", {"need": "sunglasses"}),
    ("greet", "दोनों चाहिए, पावर वाला भी और धूप वाला भी", "record_need", {"need": "both"}),
    ("greet", "आँखों की जाँच करवानी है", "record_need", {"need": "eye_test"}),
    ("greet", "मेरा frame टूट गया है, repair हो जाएगा?", "record_need", {"need": "service"}),
    ("greet", "चश्मा ढीला हो गया है, टाइट कर दीजिए", "record_need|talk_to_staff", {}),  # both → service handoff
    ("greet", "contact lens चाहिए", "record_need", {"need": "contact_lens"}),
    ("greet", "बेटे के लिए चश्मा चाहिए, आठ साल का है", "record_need", {"need": "child"}),
    ("greet", "बस ऐसे ही देख रहा हूँ", "record_need", {"need": "browsing"}),
    ("greet", "दो दिन से आँख लाल है और दर्द हो रहा है", "talk_to_staff", {"reason": "medical"}),
    ("greet", "मुझे किसी स्टाफ़ से बात करनी है, मशीन से नहीं", "talk_to_staff", {}),
    # rx — SOP stage 3
    ("rx", "हाँ, छह महीने पहले ही जाँच करवाई थी", "record_rx", {"status": "recent"}),
    ("rx", "पर्ची मेरे पास है, पिछले महीने का", "record_rx", {"status": "recent"}),
    ("rx", "तीन साल पहले करवाई थी", "record_rx", {"status": "old"}),
    ("rx", "कभी नहीं करवाई", "record_rx", {"status": "none"}),
    ("rx", "याद नहीं कब करवाई थी", "record_rx", {"status": "unsure"}),
    ("rx", "पिछले साल करवाई थी पर आजकल सिर दर्द होता है और धुंधला दिखता है", "record_rx", {"symptoms": True}),
    # eye test offer
    ("eye_test_offer", "हाँ करवा लेंगे", "eye_test_choice", {"accept": True}),
    ("eye_test_offer", "ठीक है, कर दीजिए", "eye_test_choice", {"accept": True}),
    ("eye_test_offer", "नहीं, अभी नहीं, पुराना नंबर ही चलेगा", "eye_test_choice", {"accept": False}),
    # lifestyle — SOP stage 4
    ("lifestyle", "दिन में आठ-नौ घंटे laptop पर रहता हूँ", "record_lifestyle", {"screen_hours": [8, 9]}),
    ("lifestyle", "ज़्यादा नहीं, दो घंटे फ़ोन, और रात में गाड़ी चलाता हूँ", "record_lifestyle", {"driving": True}),
    ("lifestyle", "मैं delivery करता हूँ, पूरा दिन धूप में बाहर रहता हूँ", "record_lifestyle", {"outdoor": True}),
    ("sun_lifestyle", "ड्राइविंग के लिए चाहिए", "record_lifestyle", {"driving": True}),
    ("sun_lifestyle", "धूप में ज़्यादा रहता हूँ", "record_lifestyle", {"outdoor": True}),
    ("near", "हाँ, मोबाइल पढ़ने में दिक़्क़त होती है", "record_near", {"difficulty": True}),
    ("near", "नहीं, पास का ठीक दिखता है", "record_near", {"difficulty": False}),
    # style — SOP stage 5
    ("style", "बजट पंद्रह सौ तक है, गोल वाला चाहिए", "set_preferences", {"max_price": 1500, "shape": "round"}),
    ("style", "तीन हज़ार तक, कुछ हल्का सा", "set_preferences", {"max_price": 3000, "light": True}),
    ("style", "बजट की कोई problem नहीं, square वाला", "set_preferences", {"shape": "square"}),
    ("style", "आप ही दिखा दीजिए कुछ अच्छा", "set_preferences", {}),
    ("style", "दो हज़ार के अंदर aviator", "set_preferences", {"max_price": 2000, "shape": "aviator"}),
    ("style", "ladies के लिए cat eye, अठारह सौ तक", "set_preferences", {"max_price": 1800, "shape": "cat-eye"}),
    # tryon — SOP stage 6
    ("tryon", "अगला दिखाओ", "next_frame", {}),
    ("tryon", "पिछला वाला फिर से दिखाइए", "prev_frame", {}),
    ("tryon", "तीसरा वाला दिखाओ", "show_option", {"number": 3}),
    ("tryon", "ये अच्छा है, पसंद में रख लो", "like_frame", {}),
    ("tryon", "यही लूँगा, फ़ाइनल", "choose_frame", {}),
    ("tryon", "ये थोड़ा महंगा है", "set_preferences", {}),
    ("tryon", "rectangular में कुछ है क्या?", "set_preferences", {"shape": "rectangular"}),
    ("tryon", "metal वाले दिखाओ", "set_preferences", {"material": "metal"}),
    ("tryon", "सब एक जैसे लग रहे हैं", "set_preferences", {}),
    ("tryon", "इसकी कीमत कितनी है?", None, {}),
    ("tryon", "discount मिलेगा क्या?", None, {}),
    ("tryon", "सोच के बताता हूँ, बाद में आऊँगा", "leave_for_now", {}),
    ("tryon", "हाँ, executive से बात करवा दीजिए", "talk_to_staff", {}),
    # end of set / compare — SOP stage 6
    ("end_of_set", "कुछ और फ्रेम दिखाओ", "more_frames", {}),
    ("end_of_set", "गोल वाले दिखाओ", "set_preferences", {"shape": "round"}),
    ("compare", "आप जो कह रहे हो वही ले लेते हैं", "choose_frame", {}),
    ("compare", "दूसरा वाला लूँगा", "choose_frame", {"number": 2}),
    ("compare", "एक बार दोनों फिर से पहनकर दिखाओ, पहला वाला", "show_shortlisted", {}),
    # lens — SOP stage 7
    ("lens", "जो आप suggest कर रहे हो वही", "choose_lens", {"choice": "recommended"}),
    ("lens", "सबसे सस्ता वाला", "choose_lens", {"choice": "cheapest"}),
    ("lens", "सबसे अच्छा वाला दीजिए", "choose_lens", {"choice": "best"}),
    ("lens", "blue cut वाला", "choose_lens", {"choice": "BLU-AR-01"}),
    ("lens", "ये lens आँखों की बीमारी ठीक करता है क्या?", None, {}),
    # close — SOP stage 8, consent + guest path
    ("close", "मेरा नाम राहुल शर्मा है, नंबर नौ आठ सात छह पाँच चार तीन दो एक शून्य", "save_contact", {"phone": "9876543210"}),
    ("close", "Priya, 9123456780", "save_contact", {"phone": "9123456780"}),
    ("close", "नंबर नहीं देना, ऐसे ही कर दीजिए", "skip_contact", {}),
    ("close", "नहीं, नंबर रहने दीजिए", "skip_contact", {}),
    # eye test wait
    ("eye_test_wait", "हाँ, तब तक दिखा दो", "see_frames", {}),
]


def tools_for(node):
    fns = list(node["functions"]) + F.StoreFlow(None).global_functions()
    return [{"type": "function", "function": {
        "name": f.name, "description": f.description,
        "parameters": {"type": "object", "properties": f.properties, "required": f.required}}} for f in fns]


def decide(client, node, utterance):
    system = F.ROLE + "\n\n" + "\n".join(m["content"] for m in node["task_messages"])
    tools = tools_for(node)
    kw = dict(model=MODEL, temperature=0.2, max_tokens=400,
              messages=[{"role": "system", "content": system}, {"role": "user", "content": utterance}])
    if tools:
        kw["tools"] = tools
    for attempt in range(4):
        try:
            t0 = time.perf_counter()
            r = client.chat.completions.create(**kw)
            dt = time.perf_counter() - t0
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                return "ERROR", {"error": str(e)[:120]}, 0.0
            time.sleep(2 * (attempt + 1))
    tc = r.choices[0].message.tool_calls
    if tc:
        try:
            args = json.loads(tc[0].function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        return tc[0].function.name, args, dt
    return None, {"text": r.choices[0].message.content}, dt


def ok(got_name, got_args, want_name, want_args):
    if want_name and "|" in want_name:
        return got_name in want_name.split("|")
    if got_name != want_name:
        return False
    for k, v in want_args.items():
        a = got_args.get(k)
        if k == "phone":
            a = re.sub(r"\D", "", str(a or ""))
        if isinstance(v, list):
            if a not in v and (not isinstance(a, (int, float)) or int(a) not in v):
                return False
            continue
        if k in ("max_price", "screen_hours", "number") and a is not None:
            try:
                a = int(float(a))
            except (TypeError, ValueError):
                pass
        if a != v:
            return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    nodes = asyncio.run(build_nodes())
    v = "v1" if MODEL == "sarvam-105b-conversations" else "v2"
    client = OpenAI(api_key=KEY, base_url=f"https://api.sarvam.ai/{v}", default_headers={"api-subscription-key": KEY})
    only = set(filter(None, a.only.split(",")))
    jobs = [c for c in CASES if not only or c[0] in only] * a.repeat
    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(lambda c: (c, *decide(client, nodes[c[0]], c[1])), jobs))
    good, lat, by_node = 0, [], {}
    for (node, utt, wn, wa), gn, ga, dt in results:
        passed = ok(gn, ga, wn, wa)
        good += passed
        lat.append(dt)
        by_node.setdefault(node, [0, 0])
        by_node[node][0] += passed
        by_node[node][1] += 1
        if not passed:
            print(f"FAIL [{node}] {utt!r}\n      got {gn} {json.dumps(ga, ensure_ascii=False)[:160]}  want {wn} {wa}")
    print("\nper node: " + ", ".join(f"{n} {g}/{t}" for n, (g, t) in by_node.items()))
    print(f"{MODEL}: {good}/{len(results)} correct, median {statistics.median(lat):.2f}s, max {max(lat):.2f}s")


if __name__ == "__main__":
    main()
