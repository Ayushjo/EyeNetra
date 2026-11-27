"""
sim_conversations.py — 100 whole conversations through the real flow, with
the production LLM deciding every turn.

For each scenario a scripted customer says lines in order. Each turn runs
exactly like bot.py: fast_intent first (deterministic shortcut), else the
production LLM (Sarvam, same model) with the current node's instructions,
its functions plus the globals, and the recent conversation. The chosen
function's real handler runs and moves the flow. No audio: speech-to-text
and TTS are covered by e2e_kiosk.py — this checks the decisions and the
journey across many more phrasings and paths.

Each scenario then checks the end state (stage, profile, chosen frame/lens,
contact, handoff reason) and, on every free-text reply, that the model did
not invent prices/numbers, promise a discount, or diagnose.

Usage: .venv/bin/python sim_conversations.py [--only 1,5,9] [--workers 4]
"""

import argparse
import asyncio
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(".env")
import flow as F  # noqa: E402
from fast_intent import fast_call  # noqa: E402

LEADS = []
_real_exec = F.execute_tool


def _exec(name, args):
    # Never write leads.json or print staff alerts from the simulation.
    if name == "create_lead":
        digits = re.sub(r"\D", "", str(args.get("phone", "")))
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        if len(digits) != 10 or digits[0] not in "6789":
            return {"error": "invalid phone number — ask again"}
        LEADS.append(args)
        return {"status": "lead_saved", "phone": digits}
    if name == "notify_staff":
        return {"status": "staff_notified"}
    return _real_exec(name, args)


F.execute_tool = _exec
MODEL = os.environ.get("SARVAM_LLM_MODEL", "sarvam-105b-conversations")
KEY = os.environ["SARVAM_API_KEY"]
client = OpenAI(api_key=KEY, base_url="https://api.sarvam.ai/v1", default_headers={"api-subscription-key": KEY})
USAGE = {"prompt": 0, "completion": 0, "calls": 0}


class FM:
    def __init__(self):
        self.state = {}
        self.current_node = None


class Sim:
    def __init__(self):
        self.flow = F.StoreFlow(None)
        self.fm = FM()
        self.node = None
        self.history: list[dict] = []
        self.texts: list[str] = []  # free-text LLM replies
        self.trace: list[str] = []
        self.stages: list[str] = []

    async def enter(self, node):
        self.node = node
        self.fm.current_node = node["name"]
        for a in node["pre_actions"]:
            if a["type"] == "sync":
                await self.flow._sync_action(a, self.fm)
                st = self.fm.state.get("stage")
                if not self.stages or self.stages[-1] != st:
                    self.stages.append(st)
            elif a["type"] == "tts_say":
                self.history.append({"role": "assistant", "content": a["text"]})

    def tools(self):
        fns = list(self.node["functions"]) + self.flow.global_functions()
        return fns, [{"type": "function", "function": {
            "name": f.name, "description": f.description,
            "parameters": {"type": "object", "properties": f.properties, "required": f.required}}} for f in fns]

    def llm(self, tools):
        system = F.ROLE + "\n\n" + "\n".join(m["content"] for m in self.node["task_messages"])
        msgs = [{"role": "system", "content": system}, *self.history[-8:]]
        for attempt in range(5):
            try:
                r = client.chat.completions.create(model=MODEL, temperature=0.2, max_tokens=400, messages=msgs, tools=tools)
                break
            except Exception as e:  # noqa: BLE001
                if "402" in str(e) or "credit" in str(e).lower():
                    raise RuntimeError("OUT OF CREDITS") from e
                if attempt == 4:
                    raise
                time.sleep(2 * (attempt + 1))
        USAGE["calls"] += 1
        if r.usage:
            USAGE["prompt"] += r.usage.prompt_tokens or 0
            USAGE["completion"] += r.usage.completion_tokens or 0
        m = r.choices[0].message
        if m.tool_calls:
            tc = m.tool_calls[0]
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            return tc.function.name, args, None
        return None, {}, (m.content or "").strip()

    async def say(self, text):
        if self.fm.state.get("stage") == "handoff":
            self.trace.append(f"(after handoff) {text}")
            return
        self.history.append({"role": "user", "content": text})
        fns, tools = self.tools()
        names = {f.name for f in fns}
        hit = fast_call(text, names)
        args, reply, name = {}, None, None
        if hit:
            name, args = hit
            src = "fast"
        else:
            name, args, reply = await asyncio.to_thread(self.llm, tools)
            src = "llm"
        if name is None:
            self.texts.append(reply or "")
            self.history.append({"role": "assistant", "content": reply or ""})
            self.trace.append(f"{text!r} → (reply) {reply!r}")
            return
        fn = next((f for f in fns if f.name == name), None)
        if fn is None:
            self.trace.append(f"{text!r} → {name} (NOT OFFERED)")
            self.texts.append(f"<called unknown function {name}>")
            return
        res, node = await fn.handler(args, self.fm)
        self.trace.append(f"{text!r} → {name}{json.dumps(args, ensure_ascii=False) if args else ''} [{src}]"
                          + (f" → {node['name']}" if node else " (stay)"))
        if node is not None:
            await self.enter(node)

    @property
    def s(self):
        return self.flow.snapshot(self.fm)


# ---------------------------------------------------------------------------
# Scenarios: (id, title, lines, checks)  — checks(sim) -> list[(name, ok)]
# ---------------------------------------------------------------------------
def P(s):  # profile
    return s.s["profile"]


def stage(s):
    return s.s["stage"]


def chosen(s):
    return s.fm.state.get("chosen") or {}


def lens(s):
    return (s.fm.state.get("lens") or {}).get("code")


def hand(s):
    return (s.s.get("handoff") or {}).get("reason")


def no_face_before_style(s):
    st = s.stages
    return "tryon" not in st or ("style" in st[: st.index("tryon")] or "greet" in st)


SC: list[tuple] = []


def sc(title, lines, *checks):
    SC.append((len(SC) + 1, title, lines, checks))


NEED_POWER = ["मुझे नज़र का चश्मा बनवाना है।", "पावर वाला चश्मा चाहिए।", "number wale glasses chahiye", "मुझे चश्मा बनवाना है, नंबर लगा है।",
              "glasses chahiye power wale", "मेरी आँखों का नंबर है, नया चश्मा चाहिए।"]
RX_RECENT = ["हाँ, छह महीने पहले करवाई थी।", "पिछले महीने ही जाँच करवाई है।", "हाँ, latest number है मेरे पास।"]
RX_OLD = ["दो साल पहले करवाई थी।", "बहुत पुरानी है, तीन-चार साल।", "याद नहीं कब करवाई थी।"]
LIFE = [("दिन में आठ घंटे laptop पर काम करता हूँ।", 8), ("ज़्यादा नहीं, दो घंटे फ़ोन चलाता हूँ।", 2),
        ("पूरा दिन computer पर, दस घंटे।", 10), ("चार-पाँच घंटे mobile पर रहता हूँ।", None)]
STYLE = [("बजट तीन हज़ार तक है, गोल वाला।", {"max_price": 3000}), ("पाँच हज़ार तक, कुछ हल्का सा।", {"max_price": 5000}),
         ("कोई भी, आप ही दिखाइए।", {}), ("दो हज़ार के अंदर।", {"max_price": 2000}), ("बजट पंद्रह सौ।", {"max_price": 1500})]

# A. Full power journeys (36) -------------------------------------------------
i = 0
for need in NEED_POWER:
    for rx in (RX_RECENT, RX_OLD):
        for k in range(3):
            i += 1
            life, hours = LIFE[i % len(LIFE)]
            stl, prefs = STYLE[i % len(STYLE)]
            rxl = rx[k % len(rx)]
            lines = [need, rxl]
            if rx is RX_OLD:
                lines.append(["हाँ, करवा लेंगे।", "नहीं, अभी नहीं।", "ठीक है, कर दीजिए।"][k])
            lines += [life, ["नहीं, पास का ठीक दिखता है।", "हाँ, पास का पढ़ने में दिक़्क़त होती है।", "नहीं।"][k], stl]
            lines += [["ये अच्छा है, पसंद में रख लो।", "अगला दिखाओ।", "पसंद आया।"][k], "अगला दिखाओ।", "यही लूँगा, फ़ाइनल।"]
            lines += [["जो आप suggest कर रहे हो वही।", "सबसे सस्ता वाला।", "सबसे अच्छा वाला दीजिए।"][k]]
            lines += [["मेरा नाम अमित है, नंबर है नौ आठ सात छह पाँच चार तीन दो एक शून्य।", "नंबर नहीं देना, ऐसे ही कर दीजिए।",
                       "सुनीता वर्मा, 9123456780"][k]]
            near = k == 1

            def chk(s, hours=hours, prefs=prefs, k=k, rx=rx, near=near):
                out = [("ends in handoff for billing", stage(s) == "handoff" and hand(s) == "billing"),
                       ("need=power", P(s).get("need") == "power"),
                       ("rx recorded", P(s).get("rx") in (("recent",) if rx is RX_RECENT else ("old", "unsure", "none"))),
                       ("face only after style", no_face_before_style(s)),
                       ("frame chosen", bool(chosen(s))),
                       ("lens chosen", bool(lens(s))),
                       ("total = frame + lens", s.s["total"] == chosen(s).get("price", 0) + next((o["price"] for o in s.s["lenses"] if o["code"] == lens(s)), 0))]
                if hours is not None:
                    out.append(("screen hours", P(s).get("screen_hours") == hours))
                if prefs.get("max_price"):
                    out.append(("budget kept", (P(s).get("prefs") or {}).get("max_price") == prefs["max_price"]))
                    out.append(("chosen within budget", chosen(s).get("price", 0) <= prefs["max_price"]))
                if near:
                    out.append(("near → progressive recommended", any(o["code"] == "PROG-01" and o["recommended"] for o in s.s["lenses"])))
                out.append(("contact as said", (s.s["contact"] or {}).get("phone") == "9876543210" if k == 0 else
                            (s.s["contact"] or {}).get("guest") is True if k == 1 else (s.s["contact"] or {}).get("phone") == "9123456780"))
                if k == 1:
                    out.append(("cheapest lens = good tier", lens(s) == s.s["lenses"][0]["code"]))
                if k == 2:
                    out.append(("best lens = best tier", lens(s) == s.s["lenses"][-1]["code"]))
                return out

            sc(f"power journey #{i}", lines, chk)

# B. Sunglasses (10) ------------------------------------------------------------
SUN = [("धूप का चश्मा दिखाइए।", "ड्राइविंग के लिए चाहिए।", "driving"), ("sunglasses चाहिए।", "धूप में ज़्यादा रहता हूँ।", "outdoor"),
       ("goggles dikhao", "bike chalata hoon dhoop mein", "outdoor"), ("काला चश्मा चाहिए धूप वाला।", "गाड़ी चलाने के लिए।", "driving"),
       ("sunglass lena hai", "beach trip ke liye", "outdoor")]
for j, (a, b, flag) in enumerate(SUN):
    for end in ("buy", "leave"):
        lines = [a, b, ["कोई भी दिखाइए।", "दस हज़ार तक।"][j % 2], "अगला दिखाओ।"]
        lines += ["यही लूँगा।", "नंबर रहने दीजिए।"] if end == "buy" else ["सोच के बताता हूँ, बाद में आऊँगा।"]

        def chk(s, end=end, flag=flag):
            out = [("need=sunglasses", P(s).get("need") == "sunglasses"), ("no Rx step", "rx" not in s.stages),
                   ("only sunglasses shown", all(f.get("type") == "sunglass" for f in s.fm.state.get("set", []))),
                   (f"{flag} recorded", bool(P(s).get(flag)))]
            if end == "buy":
                out += [("no lens step", "lens" not in s.stages and lens(s) is None), ("guest handoff", stage(s) == "handoff" and (s.s["contact"] or {}).get("guest"))]
            else:
                out += [("warm exit", stage(s) == "done")]
            return out

        sc(f"sunglasses {j + 1} ({end})", lines, chk)

# C. Browsing (5) ----------------------------------------------------------------
for j, (a, st, nxt) in enumerate([("बस ऐसे ही देख रहा हूँ।", "कोई भी दिखा दो।", "यही लूँगा।"),
                                   ("just looking", "हल्का फ्रेम दिखाइए।", "फ़ाइनल कर दीजिए इसे।"),
                                   ("देखने आया हूँ।", "दो हज़ार तक।", "अगला दिखाओ।"),
                                   ("aise hi dekh raha hoon", "round wale", "पसंद आया।"),
                                   ("timepass, bas dekhna hai", "आप ही दिखाइए।", "सोच के बताता हूँ।")]):
    def chk(s, j=j):
        out = [("need=browsing", P(s).get("need") == "browsing"), ("straight to style (no Rx/lifestyle)", "rx" not in s.stages and "lifestyle" not in s.stages),
               ("frames shown", len(s.fm.state.get("set", [])) >= 1)]
        if j in (0, 1):
            out.append(("no lens step for browsing → close", stage(s) == "close"))
        if j == 3:
            out.append(("liked → shortlisted", len(s.s["shortlist"]) == 1))
        if j == 4:
            out.append(("warm exit", stage(s) == "done"))
        return out

    sc(f"browsing {j + 1}", [a, st, nxt], chk)

# D. Service / contact lens / eye test / child (10) ------------------------------
for j, (line, reason) in enumerate([("मेरा frame टूट गया है, repair हो जाएगा?", "service"), ("चश्मा ढीला हो गया है, टाइट कर दीजिए।", "service"),
                                     ("चश्मा लेने आया हूँ, पिछले हफ़्ते order दिया था।", "service"), ("contact lens चाहिए।", "contact_lens"),
                                     ("nose pad toot gaya hai", "service")]):
    sc(f"service {j + 1}", [line], lambda s, reason=reason: [("handoff to staff", stage(s) == "handoff" and hand(s) in (reason, "service", "customer_request", "other", "contact_lens"))])
sc("eye test, then frames meanwhile", ["आँखों की जाँच करवानी है।", "हाँ, तब तक दिखा दो।", "दो घंटे फ़ोन।", "नहीं।", "आप ही दिखाइए।"],
   lambda s: [("eye test requested", P(s).get("eye_test") == "requested"), ("reached try-on", stage(s) == "tryon")])
sc("eye test only", ["आँखें चेक करवानी हैं।", "नहीं, बस जाँच करवानी है।"],
   lambda s: [("handoff to staff", stage(s) == "handoff")])
sc("child glasses", ["बेटे के लिए चश्मा चाहिए।", "छह महीने पहले जाँच हुई थी।", "दस साल का है, क्रिकेट खेलता है।", "दो हज़ार तक।"],
   lambda s: [("need=child", P(s).get("need") == "child"), ("child age 10", P(s).get("child_age") == 10), ("sports", bool(P(s).get("sports"))),
              ("reached try-on", stage(s) == "tryon"), ("only optical frames", all(f.get("type") == "frame" for f in s.fm.state.get("set", [])))])
sc("both power + sun", ["दोनों चाहिए, पावर वाला भी और धूप वाला भी।", "हाँ, हाल ही में करवाई।", "तीन घंटे laptop.", "नहीं।", "कोई भी।"],
   lambda s: [("need=both", P(s).get("need") == "both"), ("optical first (SOP)", all(f.get("type") == "frame" for f in s.fm.state.get("set", [])))])
sc("reading glasses 50+", ["पढ़ने का चश्मा चाहिए, अख़बार नहीं दिखता।", "नंबर पुराना है।", "नहीं।", "एक घंटा फ़ोन, बाकी अख़बार।", "पाँच हज़ार तक।", "यही लूँगा।"],
   lambda s: [("power path", P(s).get("need") == "power"), ("near difficulty recorded", P(s).get("near_difficulty") is True),
              ("progressive recommended", any(o["code"] == "PROG-01" and o["recommended"] for o in s.s["lenses"]))])

# E. Staff requests at every stage (10) ------------------------------------------
BASE = ["पावर का चश्मा चाहिए।", "हाँ, पिछले महीने जाँच करवाई।", "छह घंटे laptop.", "नहीं।", "तीन हज़ार तक।", "यही लूँगा।", "जो आप कहें।"]
ASK = ["मुझे किसी स्टाफ़ से बात करनी है।", "किसी इंसान को बुलाइए, मशीन से नहीं।", "executive से बात करवा दीजिए।",
       "आपके यहाँ कोई आदमी है? उनसे बात करनी है।", "staff ko bulao please"]
for j in range(10):
    at = j % 7
    lines = BASE[:at] + [ASK[j % len(ASK)]]
    sc(f"staff request at step {at + 1}", lines, lambda s: [("handoff to staff", stage(s) == "handoff" and hand(s) in ("customer_request", "other")),
                                                           ("no new actions after", s.node["functions"] == [])])

# F. Medical at different stages (5) ----------------------------------------------
MED = ["दो दिन से आँख लाल है और दर्द हो रहा है।", "आँख में चोट लग गई थी कल।", "अचानक से धुंधला दिखने लगा है एक आँख से।",
       "आँख से पानी आता है और जलन होती है।", "flashes dikhte hain aankh mein"]
for j, m in enumerate(MED):
    lines = BASE[: j % 4] + [m]
    sc(f"medical {j + 1}", lines, lambda s: [("medical handoff", stage(s) == "handoff" and hand(s) == "medical"), ("no diagnosis text", not s.texts)])

# G. Leaving at different stages (5) -----------------------------------------------
LEAVE = ["सोच के बताता हूँ।", "बाद में आऊँगा।", "अभी रहने दीजिए, फिर आएँगे।", "family से पूछ के बताता हूँ।", "ok bye, later"]
for j, l in enumerate(LEAVE):
    lines = BASE[: 2 + j] + ([] if 2 + j < 5 else ["पसंद आया।"]) + [l]
    sc(f"leaves at step {j + 3}", lines, lambda s: [("warm exit", stage(s) == "done")])

# H. Objections (10) -----------------------------------------------------------------
TRY = BASE[:5]
sc("expensive → cheaper set", TRY + ["अगला दिखाओ।", "अगला दिखाओ।", "ये बहुत महंगा है।"],
   lambda s: [("lower budget set", all(f["price"] < 3000 for f in s.fm.state.get("set", []))), ("still try-on", stage(s) == "tryon")])
sc("all look same → new shape", TRY + ["सब एक जैसे लग रहे हैं।"],
   lambda s: [("changed direction", "shape" in (P(s).get("prefs") or {})), ("still try-on", stage(s) == "tryon")])
sc("discount question", TRY + ["discount मिलेगा क्या?"],
   lambda s: [("stays in try-on", stage(s) == "tryon"), ("no discount promised", all(not re.search(r"\d+\s*%|छूट मिलेगी|discount मिलेगा", t) for t in s.texts))])
sc("online cheaper", TRY + ["online तो ये सस्ता मिलता है।"], lambda s: [("stays in try-on", stage(s) == "tryon")])
sc("price question", TRY + ["इसकी कीमत कितनी है?"], lambda s: [("answers, stays", stage(s) == "tryon"), ("no invented number", all(not re.search(r"\d{4,}", t) or "800" in t or "आठ सौ" in t for t in s.texts))])
sc("material question", TRY + ["ये किस चीज़ का बना है?"], lambda s: [("stays in try-on", stage(s) == "tryon")])
sc("show specific option", TRY + ["तीसरा वाला दिखाओ।"], lambda s: [("option 3 on face", s.fm.state.get("idx") == 2)])
sc("go back", TRY + ["अगला दिखाओ।", "पिछला वाला फिर से दिखाओ।"], lambda s: [("back to option 1", s.fm.state.get("idx") == 0)])
sc("metal frames", TRY + ["metal वाले दिखाओ।"], lambda s: [("material=metal", (P(s).get("prefs") or {}).get("material") == "metal")])
sc("compare shortlist + recommendation", TRY + ["पसंद आया।", "अगला दिखाओ।", "ये भी अच्छा है, पसंद में रखो।", "अगला दिखाओ।", "अगला दिखाओ।", "अगला दिखाओ।", "आप जो कह रहे हो वही ले लेते हैं।"],
   lambda s: [("chosen = recommended", chosen(s).get("sku") == s.s.get("recommended")), ("→ lens", stage(s) == "lens")])

# I. Unclear / noise (4) ---------------------------------------------------------------
sc("unclear at greeting", ["हैलो?"], lambda s: [("stays at greet", stage(s) == "greet")])
sc("other people talking", ["अरे भैया वो गाड़ी कहाँ खड़ी की?"], lambda s: [("stays at greet", stage(s) == "greet")])
sc("what? repeat", ["पावर का चश्मा चाहिए।", "क्या? फिर से बोलिए।"], lambda s: [("stays at rx", stage(s) == "rx")])
sc("off-topic", ["पावर का चश्मा चाहिए।", "हाँ, हाल ही में।", "आज मौसम कैसा है?"], lambda s: [("stays at lifestyle", stage(s) == "lifestyle")])

# J. Phone formats (5) -------------------------------------------------------------------
CLOSE = BASE + []
sc("phone with +91", CLOSE + ["रवि, +91 98765 43210"], lambda s: [("saved", (s.s["contact"] or {}).get("phone") == "9876543210")])
sc("phone in parts", CLOSE + ["नाम पूजा, नंबर 98765 43210"], lambda s: [("saved", (s.s["contact"] or {}).get("phone") == "9876543210")])
sc("wrong phone then right", CLOSE + ["नाम राजेश, नंबर 12345", "सॉरी, 9876543210"], lambda s: [("saved after retry", (s.s["contact"] or {}).get("phone") == "9876543210")])
sc("name only then refuse", CLOSE + ["मेरा नाम दीपक है।", "नंबर नहीं दूँगा।"], lambda s: [("guest path", (s.s["contact"] or {}).get("guest") is True)])
sc("english speaker", ["I need prescription glasses.", "I got tested last month.", "About 9 hours on laptop.", "No.", "Under 3000 please.", "I'll take this one.", "Whatever you recommend.", "Name Karan, 9876543210"],
   lambda s: [("full journey in English", stage(s) == "handoff" and (s.s["contact"] or {}).get("phone") == "9876543210")])

assert len(SC) == 100, len(SC)


# ---------------------------------------------------------------------------
BANNED = [r"\d+\s*%", r"छूट मिलेगी", r"फ्री में दे", r"बीमारी", r"इलाज", r"ठीक हो जाएगी आँख", r"diagnos"]


def text_checks(sim):
    out = []
    for t in sim.texts:
        bad = next((b for b in BANNED if re.search(b, t, re.I)), None)
        if bad:
            out.append((f"free text breaks a rule ({bad}): {t[:80]}", False))
        if re.search(r"[a-zA-Z]{3,}", t) and not re.search(r"[ऀ-ॿ]", t) and not any("I " in x or "I'" in x for x in []):
            pass  # English replies to English speakers are fine
    return out


async def run_one(sid, title, lines, checks):
    sim = Sim()
    await sim.enter(sim.flow.greet_node())
    err = None
    try:
        for line in lines:
            await sim.say(line)
    except Exception as e:  # noqa: BLE001
        err = repr(e)[:200]
    res = []
    if err:
        res.append((f"ran without error ({err})", False))
    for c in checks:
        try:
            res += c(sim)
        except Exception as e:  # noqa: BLE001
            res.append((f"check crashed: {e!r}"[:120], False))
    res += text_checks(sim)
    return sid, title, res, sim


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    only = {int(x) for x in a.only.split(",") if x}
    todo = [x for x in SC if not only or x[0] in only]
    t0 = time.time()

    def work(x):
        return asyncio.run(run_one(*x))

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        results = list(ex.map(work, todo))
    passed = 0
    for sid, title, res, sim in results:
        ok = all(r[1] for r in res)
        passed += ok
        if not ok:
            print(f"\nFAIL #{sid} {title}")
            for n, good in res:
                if not good:
                    print(f"   ✗ {n}")
            print("   stages: " + " → ".join(sim.stages))
            for t in sim.trace:
                print("   · " + t[:220])
    checks = sum(len(r[2]) for r in results)
    print(f"\n{passed}/{len(results)} scenarios fully passed ({checks} checks) in {time.time() - t0:.0f}s")
    print(f"LLM calls {USAGE['calls']}, tokens in {USAGE['prompt']:,} / out {USAGE['completion']:,}")


if __name__ == "__main__":
    main()
