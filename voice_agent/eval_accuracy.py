"""
eval_accuracy.py — measured accuracy of the voice agent's ears and brain.

Stage 1 (STT): each test utterance is synthesised with Sarvam bulbul:v3 in
two voices, played clean and with background shop chatter (other utterances
mixed at 8 dB SNR — "other people talking"), and transcribed with several
Sarvam saaras:v4 settings. Score = share of the utterance's key entities
(brand, shape, budget number, intent words, name/phone) recoverable from the
transcript. Entities, not raw WER, because `codemix` writes English words
in Latin script and `transcribe` in Devanagari — WER would punish the
script, not the hearing.

Stage 2 (LLM): the reference text and the STT transcripts are given to the
real flow node (flow.py's prompt + the node's functions) and we check the
function call and its arguments — which is what actually moves the
customer through the store flow.

Caveat: synthetic speech is cleaner and more standard than real customers;
this ranks settings, it does not predict field accuracy in absolute terms.

Usage:
  .venv/bin/python eval_accuracy.py stt            # stage 1
  .venv/bin/python eval_accuracy.py llm [configs]  # stage 2 (needs stage 1 cache)
"""

import asyncio
import base64
import io
import json
import os
import re
import sys
import time
import wave
import unicodedata
import zlib
from pathlib import Path

import httpx
import numpy as np
from dotenv import load_dotenv

load_dotenv(override=True)
SARVAM = os.environ["SARVAM_API_KEY"]
CACHE = Path(__file__).parent / "eval_cache"
CACHE.mkdir(exist_ok=True)
SR = 16000

# Domain words the shop actually says — the keyterms list under test.
KEYTERMS = [
    "Vincent Chase", "Lenskart", "John Jacobs", "Ray-Ban", "Fastrack", "Titan",
    "aviator", "round", "square", "rectangular", "cat-eye", "oval",
    "titanium", "metal", "acetate", "TR90", "frame", "sunglasses", "lens",
    "anti-glare", "blue cut", "progressive", "executive", "repair", "budget",
]

# ---------------------------------------------------------------------------
# Test set. node = which flow node hears it; expect = function + args;
# ents = entity regexes (any alternative counts) the transcript must contain.
# ---------------------------------------------------------------------------
NUM = {
    800: r"800|आठ ?सौ|aath ?sau",
    1500: r"1,?500|पंद्रह ?सौ|pandrah ?sau",
    1800: r"1,?800|अठारह ?सौ|atharah ?sau",
    2000: r"2,?000|दो ?हज़?ार|do ?hazaa?r",
    3500: r"3,?500|साढ़े ?तीन ?हज़?ार|तीन ?हज़?ार ?पाँच ?सौ|teen ?hazaa?r ?paa?nch ?sau",
    5000: r"5,?000|पाँच ?हज़?ार|पांच ?हज़?ार|paa?nch ?hazaa?r",
}
ROUND = r"round|राउंड|गोल"
TESTS = [
    dict(id="need_eyeglasses", node="greet", text="मुझे नज़र का चश्मा बनवाना है।",
         expect=("record_need", {"need": "power"}), ents=[r"नज़?र|nazar", r"चश्म|chashm"]),
    dict(id="need_sun", node="greet", text="धूप का चश्मा दिखाइए, sunglasses चाहिए।",
         expect=("record_need", {"need": "sunglasses"}), ents=[r"sunglass|सनग्लास|धूप"]),
    dict(id="need_test", node="greet", text="आँखों की जाँच करवानी है।",
         expect=("record_need", {"need": "eye_test"}), ents=[r"जाँच|जांच|check|test|टेस्ट"]),
    dict(id="need_repair", node="greet", text="मेरा frame टूट गया है, repair हो जाएगा क्या?",
         expect=("record_need", {"need": "service"}), ents=[r"frame|फ्रेम", r"repair|रिपेयर|टूट"]),
    dict(id="need_browse", node="greet", text="बस ऐसे ही देख रहा हूँ।",
         expect=("record_need", {"need": "browsing"}), ents=[r"देख|dekh"]),
    dict(id="need_brand", node="greet", text="Lenskart वाला round frame दिखाओ।",
         expect=("record_need", {"need": "power"}), ents=[r"lenskart|लेंसकार्ट", ROUND]),
    dict(id="medical", node="greet", text="दो दिन से आँख लाल है और दर्द हो रहा है।",
         expect=("talk_to_staff", {"reason": "medical"}), ents=[r"लाल|laal|red", r"दर्द|dard|pain"]),
    dict(id="pref_round_1500", node="style", text="बजट पंद्रह सौ तक है, गोल वाला चाहिए।",
         expect=("set_preferences", {"max_price": 1500, "shape": "round"}), ents=[NUM[1500], ROUND]),
    dict(id="pref_aviator_2000", node="style", text="दो हज़ार के अंदर कुछ aviator दिखाओ।",
         expect=("set_preferences", {"max_price": 2000, "shape": "aviator"}), ents=[NUM[2000], r"aviator|एविएटर"]),
    dict(id="pref_metal_3500", node="style", text="साढ़े तीन हज़ार तक, metal frame चाहिए।",
         expect=("set_preferences", {"max_price": 3500, "material": "metal"}), ents=[NUM[3500], r"metal|मेटल"]),
    dict(id="pref_square_nobudget", node="style", text="बजट की कोई problem नहीं, बस square वाला चाहिए।",
         expect=("set_preferences", {"shape": "square"}), ents=[r"square|स्क्वेयर|स्क्वायर|चौकोर"]),
    dict(id="pref_800", node="style", text="आठ सौ रुपये से ज़्यादा नहीं।",
         expect=("set_preferences", {"max_price": 800}), ents=[NUM[800]]),
    dict(id="pref_cateye", node="style", text="cat eye style चाहिए, ladies के लिए, अठारह सौ तक।",
         expect=("set_preferences", {"max_price": 1800, "shape": "cat-eye", "gender": "female"}),
         ents=[r"cat.?eye|कैट ?आई", r"ladies|लेडीज|female", NUM[1800]]),
    dict(id="pref_titanium", node="style", text="titanium वाला हल्का frame, पाँच हज़ार तक।",
         expect=("set_preferences", {"max_price": 5000, "material": "titanium"}), ents=[r"titanium|टाइटेनियम", NUM[5000]]),
    dict(id="show_next", node="tryon", text="अगला दिखाओ।",
         expect=("next_frame", {}), ents=[r"अगला|agla|next"]),
    dict(id="show_like", node="tryon", text="ये वाला अच्छा लग रहा है, यही लेंगे।",
         expect=("choose_frame", {}), ents=[r"अच्छा|accha|achha", r"लेंगे|lenge"]),
    dict(id="show_dislike", node="tryon", text="नहीं ये पसंद नहीं आया, दूसरा दिखाइए।",
         expect=("next_frame", {}), ents=[r"पसंद|pasand", r"दूसरा|doosra|dusra"]),
    dict(id="show_restyle", node="tryon", text="rectangular में कुछ है क्या?",
         expect=("set_preferences", {"shape": "rectangular"}), ents=[r"rectang|रेक्टें?ग|रेक्टैंग"]),
    dict(id="show_stop", node="tryon", text="बस रहने दीजिए, बाद में आऊँगा।",
         expect=("leave_for_now", {}), ents=[r"रहने|rehne|rahne", r"बाद|baad"]),
    dict(id="show_question", node="tryon", text="इसकी कीमत कितनी है?",
         expect=(None, {}), ents=[r"कीमत|keemat|kimat|price"]),
    dict(id="liked_exec", node="tryon", text="हाँ, executive से बात करवा दीजिए।",
         expect=("talk_to_staff", {}), ents=[r"executive|एग्जीक्यूटिव|एक्जीक्यूटिव"]),
    dict(id="lead_contact", node="close",
         text="मेरा नाम राहुल शर्मा है, नंबर है नौ आठ सात छह पाँच चार तीन दो एक शून्य।",
         expect=("save_contact", {"phone": "9876543210"}),
         ents=[r"राहुल|rahul", r"शर्मा|sharma", r"9 ?8 ?7 ?6 ?5 ?4 ?3 ?2 ?1 ?0|नौ ?आठ ?सात"]),
]
VOICES = ["shubh", "ritu"]

CONFIGS = {
    "transcribe": dict(mode="transcribe", language_code="hi-IN"),
    "codemix": dict(mode="codemix", language_code="hi-IN"),
    "transcribe+kt": dict(mode="transcribe", language_code="hi-IN", keyterms=True),
    "codemix+kt": dict(mode="codemix", language_code="hi-IN", keyterms=True),
    "codemix+auto": dict(mode="codemix", language_code="unknown"),
}


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------
def wav_bytes(pcm: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.clip(pcm, -32768, 32767).astype(np.int16).tobytes())
    return buf.getvalue()


def read_wav(b: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(b)) as w:
        assert w.getframerate() == SR, w.getframerate()
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)


async def tts(client: httpx.AsyncClient, text: str, voice: str) -> np.ndarray:
    path = CACHE / f"tts_{voice}_{zlib.crc32(text.encode())}.wav"
    if not path.exists():
        r = await client.post(
            "https://api.sarvam.ai/text-to-speech",
            headers={"api-subscription-key": SARVAM},
            json={"text": text, "target_language_code": "hi-IN", "model": "bulbul:v3",
                  "speaker": voice, "speech_sample_rate": SR, "pace": 1.0},
            timeout=60,
        )
        r.raise_for_status()
        path.write_bytes(base64.b64decode(r.json()["audios"][0]))
    return read_wav(path.read_bytes())


def add_babble(speech: np.ndarray, others: list[np.ndarray], snr_db: float, seed: int) -> np.ndarray:
    """Mix 3 other talkers (looped, offset) under the speech at the given SNR."""
    rng = np.random.default_rng(seed)
    bab = np.zeros_like(speech)
    for o in rng.choice(len(others), 3, replace=False):
        src = np.tile(others[o], int(np.ceil(len(speech) / len(others[o]))) + 1)
        off = rng.integers(0, len(others[o]))
        bab += src[off:off + len(speech)]
    ps, pb = np.mean(speech**2), np.mean(bab**2) + 1e-9
    return speech + bab * np.sqrt(ps / (pb * 10 ** (snr_db / 10)))


# ---------------------------------------------------------------------------
# STT
# ---------------------------------------------------------------------------
async def stt(client: httpx.AsyncClient, audio: bytes, cfg: dict) -> str:
    data = {"model": "saaras:v4", "mode": cfg["mode"], "language_code": cfg["language_code"]}
    if cfg.get("keyterms"):
        data["keyterms"] = json.dumps(KEYTERMS)
    for attempt in range(8):
        r = await client.post(
            "https://api.sarvam.ai/speech-to-text",
            headers={"api-subscription-key": SARVAM},
            files={"file": ("a.wav", audio, "audio/wav")},
            data=data,
            timeout=60,
        )
        if r.status_code == 429:
            await asyncio.sleep(min(30, 3 * 2**attempt))
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"STT {r.status_code}: {r.text[:300]}")
        return r.json().get("transcript", "")
    raise RuntimeError("STT rate-limited")


def _nf(s: str) -> str:
    # Sarvam may emit precomposed ढ़ / ज़ or base+nukta; compare canonically.
    return unicodedata.normalize("NFC", s).lower()


def entity_score(text: str, ents: list[str]) -> tuple[int, int]:
    t = _nf(text)
    return sum(1 for e in ents if re.search(_nf(e), t)), len(ents)


async def run_stt(only: list[str] | None = None):
    configs = {k: v for k, v in CONFIGS.items() if not only or k in only}
    async with httpx.AsyncClient() as client:
        clips = {}
        for v in VOICES:
            for t in TESTS:
                clips[(t["id"], v)] = await tts(client, t["text"], v)
        others = list(clips.values())
        conditions = {}
        for (tid, v), pcm in clips.items():
            pad = np.zeros(int(0.3 * SR), dtype=np.float32)
            clean = np.concatenate([pad, pcm, pad])
            conditions[(tid, v, "clean")] = wav_bytes(clean)
            rest = [o for o in others if o is not pcm]
            seed = zlib.crc32(f"{tid}|{v}".encode())
            conditions[(tid, v, "babble8")] = wav_bytes(add_babble(clean, rest, 8, seed))
            # Crowded shop: other talkers as loud as the customer.
            conditions[(tid, v, "babble0")] = wav_bytes(add_babble(clean, rest, 0, seed))

        sem = asyncio.Semaphore(2)
        out = CACHE / "stt_results.json"
        saved = json.loads(out.read_text()) if out.exists() else {}
        results = {}

        async def one(name, cfg, key):
            k = "|".join((name, *key))
            if k in saved:
                results[(name, *key)] = saved[k]
                return
            async with sem:
                results[(name, *key)] = saved[k] = await stt(client, conditions[key], cfg)
                out.write_text(json.dumps(saved, ensure_ascii=False, indent=1))

        t0 = time.time()
        await asyncio.gather(*(one(n, c, k) for n, c in configs.items() for k in conditions))
        print(f"{len(results)} transcriptions in {time.time() - t0:.0f}s\n")


    by_id = {t["id"]: t for t in TESTS}
    conds = ("clean", "babble8", "babble0")
    print(f"{'config':16} {'clean':>8} {'babble8':>8} {'babble0':>8} {'all':>8}   (entity recall)")
    for name in configs:
        row = {}
        for cond in conds:
            hit = tot = 0
            for (n, tid, v, c), txt in results.items():
                if n == name and c == cond:
                    h, k = entity_score(txt, by_id[tid]["ents"])
                    hit, tot = hit + h, tot + k
            row[cond] = (hit, tot)
        allh = sum(h for h, _ in row.values())
        allt = sum(t for _, t in row.values())
        print(f"{name:16} " + " ".join(f"{row[c][0] / row[c][1]:8.1%}" for c in conds) + f" {allh / allt:8.1%}")
    print("\nMisses (babble0):")
    for name in configs:
        for v in VOICES:
            for t in TESTS:
                txt = results[(name, t["id"], v, "babble0")]
                h, k = entity_score(txt, t["ents"])
                if h < k:
                    print(f"  [{name}/{v}] {t['id']}: {txt}")


# ---------------------------------------------------------------------------
# LLM (stage 2)
# ---------------------------------------------------------------------------
def node_for(name: str):
    """Build the real flow node the utterance is heard in (flow.py)."""
    import flow as F

    sf = F.StoreFlow(None)

    class FM:  # minimal flow manager for the node builders
        def __init__(self):
            self.state = {}
            self.current_node = None

    fm = FM()
    if name == "greet":
        return sf.greet_node(), F.ROLE
    if name == "style":
        return sf.style_node(), F.ROLE
    fm.state["profile"] = {"need": "power"}
    frames, _ = F.curate({"frame_type": "frame"})
    if name == "tryon":
        fm.state["set"] = frames
        return sf._tryon(fm, 0), F.ROLE
    if name == "close":
        fm.state["chosen"] = frames[0]
        fm.state["lens"] = None
        return sf._close(fm), F.ROLE
    raise KeyError(name)


def llm_decide(client, model: str, node_name: str, utterance: str):
    from google.genai import types
    import flow as F

    node, role = node_for(node_name)
    sf = F.StoreFlow(None)
    fns = list(node["functions"]) + sf.global_functions()
    decls = [
        types.FunctionDeclaration(
            name=f.name, description=f.description,
            parameters={"type": "object", "properties": f.properties, "required": f.required} if f.properties else None,
        )
        for f in fns
    ]
    system = role + "\n\n" + "\n".join(m["content"] for m in node["task_messages"])
    for attempt in range(6):
        try:
            r = client.models.generate_content(
                model=model,
                contents=[types.Content(role="user", parts=[types.Part(text=utterance)])],
                config=types.GenerateContentConfig(
                    system_instruction=system, temperature=0.2, max_output_tokens=400,
                    tools=[types.Tool(function_declarations=decls)],
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            break
        except Exception as e:  # quota / overload: back off
            if "429" in str(e) or "503" in str(e) or "UNAVAILABLE" in str(e):
                time.sleep(15 * (attempt + 1))
                continue
            raise
    else:
        return "ERROR", {}
    for p in (r.candidates[0].content.parts or []) if r.candidates and r.candidates[0].content else []:
        if p.function_call:
            return p.function_call.name, dict(p.function_call.args or {})
    return None, {}


def decision_ok(got: tuple, expect: tuple) -> bool:
    name, args = got
    ename, eargs = expect
    if name != ename:
        return False
    for k, v in eargs.items():
        a = args.get(k)
        if k == "phone":
            a = re.sub(r"\D", "", str(a or ""))
        if k == "max_price" and a is not None:
            try:
                a = int(float(a))
            except ValueError:
                pass
        if a != v:
            return False
    return True


def run_llm(configs: list[str]):
    """Decision accuracy on the reference text and on STT output; for the
    crowded-shop condition (babble0) also the HARMFUL rate — a wrong action
    taken on garbled input (asking to repeat = no call = safe)."""
    from google import genai

    model = os.environ.get("EVAL_MODEL", os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash")
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    stt_res = json.loads((CACHE / "stt_results.json").read_text())
    llm_cache_path = CACHE / f"llm_{model}.json"
    llm_cache = json.loads(llm_cache_path.read_text()) if llm_cache_path.exists() else {}

    def decide(node, utt):
        k = f"{node}|{utt}"
        if k not in llm_cache:
            llm_cache[k] = list(llm_decide(client, model, node, utt))
            llm_cache_path.write_text(json.dumps(llm_cache, ensure_ascii=False, indent=1))
        return tuple(llm_cache[k])

    print(f"model {model}")
    sources = [("reference", None, "ref")] + [(f"{c}/{cond}", c, cond) for c in configs for cond in ("babble8", "babble0")]
    for label, cfg, cond in sources:
        ok = harmful = n = 0
        fails = []
        for t in TESTS:
            utts = [t["text"]] if cfg is None else [stt_res[f"{cfg}|{t['id']}|{v}|{cond}"] for v in VOICES]
            for utt in utts:
                got = decide(t["node"], utt)
                good = decision_ok(got, t["expect"])
                bad = not good and got[0] not in (None, "ERROR")
                ok, harmful, n = ok + good, harmful + bad, n + 1
                if not good:
                    fails.append(f"    {'HARM' if bad else 'safe'} {t['id']} heard {utt!r} → {got[0]} {got[1]} (want {t['expect'][0]} {t['expect'][1]})")
        print(f"{label:22} correct {ok}/{n} = {ok / n:.1%}   wrong action {harmful}/{n} = {harmful / n:.1%}")
        print("\n".join(fails))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "stt"
    if stage == "stt":
        asyncio.run(run_stt(sys.argv[2:] or None))
    else:
        run_llm(sys.argv[2:] or ["transcribe"])
