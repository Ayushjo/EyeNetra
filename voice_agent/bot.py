"""
bot.py — Pipecat voice pipeline for the Eyenetra in-store assistant.

    WebRTC in → Sarvam STT (saaras) → TranscriptGate → user aggregator
      → Gemini (driven by Pipecat Flows, flow.py) → ThinkingFiller
      → Sarvam TTS (bulbul:v3, HindiSpeechFilter) → WebRTC out

The conversation is a state machine in flow.py: fixed spoken lines for the
greeting / frame announcements / "पसंद आया, या अगला दिखाऊँ?", per-stage
tools, and showing a frame on the customer's face as a node action (an RTVI
server message to the try-on page), not an LLM promise.

Usage: python bot.py  (serves http://localhost:7860; needs SARVAM_API_KEY and
GEMINI_API_KEY in .env)
"""

import asyncio
import os
import re
from typing import Awaitable, Callable

from dotenv import load_dotenv
from loguru import logger

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InterruptionFrame,
    LLMAssistantPushAggregationFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    TTSTextFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.utils.text.base_text_aggregator import TextType
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.sarvam.llm import SarvamLLMService
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.audio.filters.rnnoise_filter import RNNoiseFilter
from pipecat.turns.user_start import MinWordsUserTurnStartStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from catalogue import stt_keyterms
from fast_intent import fast_intent
from flow import StoreFlow
from turn_completion import HindiAwareTurnStopStrategy
from pipecat.flows import FlowManager
from speech_text import HindiSpeechFilter

load_dotenv(override=True)

# ---------------------------------------------------------------------------
# Workaround for two live bugs in pipecat-ai 1.7.0's SarvamTTSService._send_config():
#
# 1. It sends the wire key "target_language_code", but Sarvam's streaming TTS
#    API expects "language_code" (confirmed against
#    https://docs.sarvam.ai/api-reference-docs/text-to-speech/stream).
# 2. It also sends "min_buffer_size" and "max_chunk_length" — pipecat's own
#    internal text-buffering knobs — as if they were part of Sarvam's wire
#    protocol. They aren't in Sarvam's documented config schema at all.
#
# Verified live against the real Sarvam API: with both bugs present, every
# config message is rejected with "Input parameters has to be a valid
# dictionary" and the bot never speaks. Fixing #1 alone did not resolve it —
# #2 (unexpected extra fields) was the actual cause of the rejection.
# Nothing to fix in bot.py itself — this corrects a third-party library bug.
# Delete this block once pipecat-ai ships a fix.
# ---------------------------------------------------------------------------
import json as _json

import pipecat.services.sarvam.tts as _sarvam_tts_module


async def _patched_sarvam_tts_send_config(self):
    if not self._websocket:
        raise Exception("WebSocket not connected")
    config_data = {
        "language_code": self._settings.language,  # was "target_language_code"
        "speaker": self._settings.voice,
        "speech_sample_rate": self._speech_sample_rate,
        "enable_preprocessing": self._settings.enable_preprocessing,
        # min_buffer_size / max_chunk_length deliberately omitted — not part
        # of Sarvam's wire schema, see comment above.
        "output_audio_codec": self._output_audio_codec,
        "output_audio_bitrate": self._output_audio_bitrate,
        "pace": self._settings.pace,
        "model": self._settings.model,
    }
    if self._settings.pitch is not None:
        config_data["pitch"] = self._settings.pitch
    if self._settings.loudness is not None:
        config_data["loudness"] = self._settings.loudness
    if self._settings.temperature is not None:
        config_data["temperature"] = self._settings.temperature
    logger.debug(f"Config being sent is {config_data}")
    config_message = {"type": "config", "data": config_data}
    try:
        await self._websocket.send(_json.dumps(config_message))
        logger.debug("Configuration sent successfully")
    except Exception as e:
        await self.push_error(error_msg=f"Unknown error occurred: {e}", exception=e)
        raise


_sarvam_tts_module.SarvamTTSService._send_config = _patched_sarvam_tts_send_config

# gemini-2.0-flash(-lite) are retired (404). Google's own error message points
# to gemini-3.6-flash, but that hangs indefinitely in practice (verified live —
# even a trivial no-tools call never returns). gemini-2.5-flash is confirmed
# fast (~1.3s) and stable with this key.
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
# Quota fallback (see _RetryingGoogleLLMService). Slower but not rate-capped.
# Quota fallback. Measured 8 Oct with this key: gemini-3.5-flash-lite 1.4 s,
# gemini-3.8-flash 15.4 s (too slow for voice), 3.1-flash-lite 3–9 s earlier.
FALLBACK_MODEL = os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite")

def _shortcut(context) -> str | None:
    """fast_intent.py: the function an unambiguous customer reply maps to
    in the current node, or None. Only when this call answers a fresh
    customer message (not a function result)."""
    try:
        messages = context.get_messages()
        last = messages[-1] if messages else None
        if not last or last.get("role") != "user":
            return None
        content = last.get("content")
        text = content if isinstance(content, str) else " ".join(
            p.get("text", "") for p in content or [] if isinstance(p, dict))
        tools = context.tools
        names = {t.name for t in getattr(tools, "standard_tools", [])}
        return fast_intent(text, names)
    except Exception as e:  # never let the shortcut break a turn
        logger.warning(f"fast_intent skipped: {e}")
        return None


class _RetryingGoogleLLMService(GoogleLLMService):
    """GoogleLLMService with a fast primary model and a quota fallback.

    Measured on this key (scratch bench, 5 Oct): gemini-2.5-flash answers in
    ~1.2 s but is capped at ~4 requests/min (429 on the 5th); gemini-3.1-
    flash-lite has headroom but takes ~3.5 s and 503s under load. A customer
    turn with a tool call is two requests, so a 429 mid-conversation is
    routine — the old 3 s sleep-and-retry just added dead air on top.

    Strategy: on 429/RESOURCE_EXHAUSTED switch to the fallback model for
    FALLBACK_HOLD_S and retry immediately; on 503/UNAVAILABLE retry once after
    a short pause. Retry is only safe before the first chunk is emitted — once
    text or function-call frames are on the wire, replaying would duplicate
    them, so mid-stream errors propagate unchanged.
    """

    FALLBACK_HOLD_S = 60.0

    def __init__(self, *args, primary_model: str, fallback_model: str, **kwargs):
        super().__init__(*args, **kwargs)
        self._primary_model = primary_model
        self._fallback_model = fallback_model
        self._fallback_until = 0.0

    def _pick_model(self):
        import time as _time

        want = (
            self._fallback_model
            if _time.monotonic() < self._fallback_until
            else self._primary_model
        )
        if self._settings.model != want:
            logger.info(f"{self}: using model {want}")
            self._settings.model = want

    async def _stream_response(self, context):  # noqa: ANN001, ANN202 - mirror base signature
        import time as _time

        name = _shortcut(context)
        if name:
            from google.genai import types as _gt

            logger.info(f"fast_intent: {name} (LLM skipped)")
            yield _gt.GenerateContentResponse(
                candidates=[_gt.Candidate(content=_gt.Content(
                    role="model", parts=[_gt.Part(function_call=_gt.FunctionCall(name=name, args={}))]))]
            )
            return

        self._pick_model()
        emitted = False
        try:
            async for chunk in super()._stream_response(context):
                emitted = True
                yield chunk
        except Exception as e:
            message = str(e)
            quota = "429" in message or "RESOURCE_EXHAUSTED" in message
            overloaded = "503" in message or "UNAVAILABLE" in message
            if emitted or not (quota or overloaded):
                raise
            if quota and self._settings.model == self._primary_model:
                self._fallback_until = _time.monotonic() + self.FALLBACK_HOLD_S
                logger.warning(
                    f"{self}: {self._primary_model} quota hit — "
                    f"{self._fallback_model} for {self.FALLBACK_HOLD_S:.0f}s"
                )
                self._pick_model()
            else:
                logger.warning(f"{self}: transient Gemini error ({message[:80]}) — retrying in 1.5s")
                await asyncio.sleep(1.5)
            async for chunk in super()._stream_response(context):
                yield chunk



# LLM provider. Sarvam measured 17 Nov on the 22 eval_accuracy decisions:
# sarvam-105b-conversations 21/22 right, median 0.21 s (paid Gemini ~1.1 s,
# free Gemini 429s after a few calls). Same SARVAM_API_KEY as STT/TTS.
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "sarvam")
SARVAM_LLM_MODEL = os.environ.get("SARVAM_LLM_MODEL", "sarvam-105b-conversations")


class _ListStream:
    """Async stream over prebuilt chunks (the fast_intent shortcut)."""

    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for c in self._chunks:
            yield c


class _FastSarvamLLMService(SarvamLLMService):
    """Sarvam LLM + the fast_intent shortcut + one retry on a transient
    error (only before streaming starts, so nothing is duplicated)."""

    async def get_chat_completions(self, context):  # noqa: ANN001, ANN201
        name = _shortcut(context)
        if name:
            from openai.types.chat import ChatCompletionChunk

            logger.info(f"fast_intent: {name} (LLM skipped)")
            chunk = ChatCompletionChunk.model_validate({
                "id": "fast-intent", "object": "chat.completion.chunk", "created": 0,
                "model": "fast-intent",
                "choices": [{"index": 0, "finish_reason": "tool_calls", "delta": {
                    "role": "assistant",
                    "tool_calls": [{"index": 0, "id": f"fast-{name}", "type": "function",
                                    "function": {"name": name, "arguments": "{}"}}],
                }}],
            })
            return _ListStream([chunk])
        try:
            return await super().get_chat_completions(context)
        except Exception as e:
            msg = str(e)
            if not any(k in msg for k in ("429", "500", "502", "503", "504", "timed out", "Timeout")):
                raise
            logger.warning(f"{self}: transient Sarvam error ({msg[:80]}) — retrying in 0.5s")
            await asyncio.sleep(0.5)
            return await super().get_chat_completions(context)


class KeytermSarvamSTTService(SarvamSTTService):
    """SarvamSTTService that sends saaras:v4 `keyterms` (recognition hints).

    pipecat 1.12 and sarvamai 0.1.28 don't expose the parameter, but the SDK
    forwards `request_options["additional_query_parameters"]` onto the
    streaming URL, and the WS spec lists `keyterms` as a query parameter
    (docs.sarvam.ai …/speech-to-text/transcribe/ws; REST docs: JSON array,
    ≤50 terms × 64 chars, saaras:v4 only). Verified the socket accepts it.
    Measured (eval_accuracy.py, crowded-shop 0 dB babble): entity recall
    60.8 % → 64.9 %; clean and 8 dB unchanged at 100 %.
    """

    def __init__(self, *args, keyterms: list[str], **kwargs):
        super().__init__(*args, **kwargs)
        streaming = self._sarvam_client.speech_to_text_streaming
        original_connect = streaming.connect
        extra = {"keyterms": _json.dumps(keyterms, ensure_ascii=False)}

        def connect_with_keyterms(*a, request_options=None, **kw):
            ro = dict(request_options or {})
            ro["additional_query_parameters"] = {**(ro.get("additional_query_parameters") or {}), **extra}
            return original_connect(*a, request_options=ro, **kw)

        streaming.connect = connect_with_keyterms


class TranscriptGate(FrameProcessor):
    """Drops STT fragments that are not a customer turn.

    Live kiosk reality (bot.log 12:31–12:35): other people talking in the
    room produced one- or two-word fragments ("के।", "मेरा।", "जैसे।") and
    each one started a full LLM round, so the agent answered background
    chatter and burned the per-minute quota. Sarvam's own VAD cannot tell
    who is talking; the cheapest robust filter is length — unless the fragment
    is one of the short answers the SOP genuinely expects.
    """

    SHORT_OK = {
        "haan", "han", "ha", "haanji", "nahi", "nahin", "na", "ji", "ok", "okay",
        "theek", "thik", "dikhao", "dikhaiye", "agla", "pehla", "dusra", "yes",
        "no", "yeh", "ye", "wo", "woh", "sunglasses", "chashma", "frame", "lens",
        "हाँ", "हां", "नहीं", "ना", "जी", "ठीक", "दिखाओ", "दिखाइए", "अगला", "पहला",
        "दूसरा", "सनग्लासेस", "चश्मा", "फ्रेम", "लेंस", "हां जी", "हाँ जी", "ठीक है",
        # One-word answers the Flows steps expect (flow.py): next / like /
        # stop / repeat, budgets, styles.
        "अगला", "अगली", "आगे", "पसंद", "बढ़िया", "अच्छा", "बस", "रुको", "रुकिए", "चलो",
        "दोबारा", "गोल", "चौकोर", "aviator", "round", "square", "next", "like", "stop",
        "हज़ार", "हजार", "सौ", "pasand", "accha", "bas", "next",
    }
    MIN_WORDS = 2

    def __init__(self):
        super().__init__()
        self.dropped = 0

    def _is_customer_turn(self, text: str) -> bool:
        words = [w.strip("।.,?!ः") for w in text.split()]
        words = [w for w in words if w]
        if len(words) >= self.MIN_WORDS:
            return True
        joined = " ".join(words).lower()
        return joined in self.SHORT_OK or any(w.lower() in self.SHORT_OK for w in words)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and not self._is_customer_turn(frame.text):
            self.dropped += 1
            logger.info(f"TranscriptGate: dropped fragment {frame.text!r} (total {self.dropped})")
            return
        await self.push_frame(frame, direction)


class ThinkingFiller(FrameProcessor):
    """Speaks a short acknowledgement when the LLM is slow to answer.

    Sits between the LLM and TTS. Measured live (bot.log 12:17–12:19): Gemini
    TTFB ranged 3.3–9.4 s under load, which the customer experiences as a dead
    kiosk. When no LLM text has arrived FILLER_AFTER_S after the request
    starts, a filler like "Ek second ji…" is queued to TTS; the real reply then
    plays right after it. Fires at most once per customer turn, never while a
    tool call is still being resolved (those are already mid-answer).
    """

    # gemini-2.5-flash answers in ~1.5 s; only cover genuinely slow calls
    # (fallback model, overload) so the filler is not heard on every turn.
    FILLER_AFTER_S = 1.8
    FILLERS = ("एक सेकंड जी…", "हाँ जी, देखता हूँ…", "एक मिनट…")

    def __init__(self):
        super().__init__()
        self._timer: asyncio.Task | None = None
        self._said_this_turn = False
        self._count = 0

    def _cancel(self):
        if self._timer and not self._timer.done():
            self._timer.cancel()
        self._timer = None

    async def _fire(self):
        try:
            await asyncio.sleep(self.FILLER_AFTER_S)
        except asyncio.CancelledError:
            return
        if self._said_this_turn:
            return
        self._said_this_turn = True
        text = self.FILLERS[self._count % len(self.FILLERS)]
        self._count += 1
        logger.info(f"ThinkingFiller: LLM silent for {self.FILLER_AFTER_S}s — speaking filler")
        await self.push_frame(TTSSpeakFrame(text))

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, UserStoppedSpeakingFrame):
            self._said_this_turn = False
        elif isinstance(frame, LLMFullResponseStartFrame):
            self._cancel()
            if not self._said_this_turn:
                self._timer = asyncio.create_task(self._fire())
        elif isinstance(frame, (LLMTextFrame, LLMFullResponseEndFrame)):
            self._cancel()
        await self.push_frame(frame, direction)


class CaptionOnlyTTS(FrameProcessor):
    """Text mode's stand-in for TTS: no audio — the bot's words reach the
    page as captions.

    Used when the customer types instead of talking (no Sarvam STT/TTS). It
    turns what TTS would have spoken — the Flows fixed lines (TTSSpeakFrame)
    and the LLM's replies (LLMTextFrame, regrouped into sentences) — into
    TTSTextFrames. The output transport releases those and the RTVI observer
    forwards them as `bot-tts-text`, the same captions the page shows in voice
    mode. Speaking start/stop is marked after the transport (CaptionSpeaking-
    Marker), in order with the text.
    """

    _SENTENCE_END = re.compile(r"(?<=[।.!?…])\s+")

    def __init__(self):
        super().__init__()
        self._buffer = ""

    async def _caption(self, text: str, append_to_context: bool = True):
        text = text.strip()
        if not text:
            return
        frame = TTSTextFrame(text, text_type=TextType.SENTENCE)
        frame.append_to_context = append_to_context
        await self.push_frame(frame)

    async def _flush(self, final: bool):
        parts = self._SENTENCE_END.split(self._buffer)
        done, self._buffer = (parts, "") if final else (parts[:-1], parts[-1])
        for sentence in done:
            await self._caption(sentence)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSSpeakFrame):
            await self._caption(frame.text, frame.append_to_context)
            # What a real TTS pushes once a TTSSpeakFrame is spoken: commit the
            # fixed line to the context — and, here, the end of the utterance.
            await self.push_frame(LLMAssistantPushAggregationFrame())
        elif isinstance(frame, LLMTextFrame) and not getattr(frame, "skip_tts", False):
            self._buffer += frame.text
            await self._flush(final=False)
        elif isinstance(frame, LLMFullResponseEndFrame):
            await self._flush(final=True)
            await self.push_frame(frame, direction)
        elif isinstance(frame, InterruptionFrame):
            self._buffer = ""
            await self.push_frame(frame, direction)
        else:
            await self.push_frame(frame, direction)


class CaptionSpeakingMarker(FrameProcessor):
    """Text mode: "bot started / stopped speaking", which the output
    transport derives from audio in voice mode.

    Sits right after the output transport, so it sees the captions in the
    order the transport releases them. Bot{Started,Stopped}SpeakingFrame are
    system frames: pushed from before the transport they overtake the queued
    text, and the RTVI observer — which holds bot text until the bot "starts
    speaking" — would sit on every caption until the next utterance.
    """

    def __init__(self):
        super().__init__()
        self._speaking = False

    async def _set_speaking(self, speaking: bool):
        if speaking == self._speaking:
            return
        self._speaking = speaking
        cls = BotStartedSpeakingFrame if speaking else BotStoppedSpeakingFrame
        down, up = cls(), cls()
        down.broadcast_sibling_id = up.id
        up.broadcast_sibling_id = down.id
        await self.push_frame(down)
        await self.push_frame(up, FrameDirection.UPSTREAM)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM and isinstance(frame, TTSTextFrame):
            # The observer already queued this caption as the transport pushed
            # it; "started speaking" releases it to the page.
            await self._set_speaking(True)
            await self.push_frame(frame, direction)
        elif direction == FrameDirection.DOWNSTREAM and isinstance(
            frame, (LLMFullResponseEndFrame, LLMAssistantPushAggregationFrame)
        ):
            await self.push_frame(frame, direction)
            await self._set_speaking(False)
        elif isinstance(frame, InterruptionFrame):
            await self.push_frame(frame, direction)
            await self._set_speaking(False)
        else:
            await self.push_frame(frame, direction)


def _make_ui_pusher(task: "PipelineTask") -> Callable[[dict], Awaitable[None]]:
    """Send a UI event (flow.py: try_on_frame / liked / session_end) to the
    browser as an RTVI server message.

    The task's auto-attached RTVIObserver turns the frame into a
    {"label": "rtvi-ai", "type": "server-message"} app message on the WebRTC
    data channel — that is how the voice agent drives the try-on screen.
    """

    async def push(msg: dict) -> None:
        try:
            await task.queue_frames([RTVIServerMessageFrame(data=msg)])
        except Exception as e:
            # A missing/closed data channel must not break the spoken reply.
            logger.warning(f"Could not push UI message to client: {e}")

    return push


def _is_text_session(runner_args: RunnerArguments) -> bool:
    """Text mode: the customer types (quick replies / keyboard) and reads the
    replies as captions — no mic, no Sarvam STT/TTS.

    Chosen per session by the page, which offers to /api/offer?session_id=
    text-<uuid> (the runner's offer route keeps session_id; it drops the
    client's camelCase requestData). VOICE_MODE=text forces it for everyone.
    """
    if os.environ.get("VOICE_MODE", "").strip().lower() == "text":
        return True
    return str(getattr(runner_args, "session_id", "") or "").startswith("text-")


async def bot(runner_args: RunnerArguments) -> None:
    text_mode = _is_text_session(runner_args)
    logger.info(
        f"Session {getattr(runner_args, 'session_id', '?')}: "
        f"{'TEXT mode (typed input, captions only)' if text_mode else 'VOICE mode'}"
    )
    transport = await create_transport(
        runner_args,
        {
            # webrtc only for now: PART2_PLAN.md specifies Daily, but
            # daily-python (Daily's transport) ships no Windows wheels at
            # all — only macOS/Linux — so it can't install on this machine.
            # Pipecat's own SmallWebRTC transport needs no native Daily SDK
            # and runs locally at http://localhost:7860. Add a "daily" entry
            # back (DailyParams from pipecat.transports.daily.transport) if
            # this later moves to WSL/Linux/the kiosk box directly.
            #
            # No Silero VAD here on purpose either way: Sarvam's STT does
            # server-side VAD, and two VADs disagreeing produces phantom
            # interruptions.
            "webrtc": lambda: TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                # Free, keyless noise suppression before STT (fans, street,
                # shop hum). Krisp would also remove OTHER voices but needs a
                # licence — swap in KrispVivaFilter if that is bought.
                audio_in_filter=RNNoiseFilter(),
            ) if not text_mode else TransportParams(
                # Text mode: the page sends no mic; replies are captions only.
                audio_in_enabled=False,
                audio_out_enabled=True,
            ),
        },
    )

    # Speech in/out — voice mode only. Text mode has neither (no mic; the
    # replies are captions), so it runs without any Sarvam credits.
    stt = tts = None
    if not text_mode:
        stt = KeytermSarvamSTTService(
            api_key=os.getenv("SARVAM_API_KEY"),
            keyterms=stt_keyterms(),
            # pipecat 1.12 removed the saarika models — only saaras:v3/v4 remain,
            # and both default to mode="transcribe" (not translate), so no mode=
            # is needed. saaras:v4 is the current model.
            settings=SarvamSTTService.Settings(
                model="saaras:v4",
                language=Language.HI_IN,
                # Turns on Sarvam's server-side VAD, which is what emits the
                # UserStarted/UserStoppedSpeakingFrame pair ExternalUserTurnStopStrategy
                # below listens for. Without this, nothing signals turn-stop at all.
                vad_signals=True,
            ),
        )

        @stt.event_handler("on_connection_error")
        async def on_stt_connection_error(service, error):
            # Sarvam's realtime STT has no working auto-reconnect despite
            # reconnect_on_error=True (PART2_PLAN.md, Production settings). Rather
            # than a fragile in-process hot-swap, log loudly and end the task —
            # deploy bot.py under a process supervisor (pm2/systemd) that restarts
            # on exit, so a dropped STT socket costs one reconnect, not a deaf kiosk.
            logger.error(f"Sarvam STT connection error: {error} — ending task for restart")
            await task.cancel()

        tts = SarvamTTSService(
            api_key=os.getenv("SARVAM_API_KEY"),
            settings=SarvamTTSService.Settings(
                model="bulbul:v3",
                language=Language.HI_IN,  # default is English — must be set for Hindi output
                min_buffer_size=20,  # default 50 is the single biggest latency cost
                # Fixed voice + pace; temperature down from the 0.6 default — Sarvam:
                # lower is "more stable and consistent" (range 0.01–2.0).
                voice="shubh",
                pace=1.0,
                temperature=0.25,
            ),
            # Prices/numbers → Devanagari words in Python, every time (speech_text.py).
            text_filters=[HindiSpeechFilter()],
        )

    if LLM_PROVIDER == "gemini":
        llm = _RetryingGoogleLLMService(
            api_key=os.getenv("GEMINI_API_KEY"),
            primary_model=MODEL,
            fallback_model=FALLBACK_MODEL,
            settings=GoogleLLMService.Settings(
                model=MODEL,
                # No system_instruction: Pipecat Flows sets it per conversation
                # node (flow.ROLE + each node's task).
                # Low temperature: the SOP script must play out the same way for
                # every customer — same stage order, same phrasing style.
                temperature=0.2,
                max_tokens=400,
            ),
        )
    else:
        llm = _FastSarvamLLMService(
            api_key=os.getenv("SARVAM_API_KEY"),
            settings=SarvamLLMService.Settings(
                model=SARVAM_LLM_MODEL,
                # Same as Gemini: low temperature so the SOP plays out the
                # same way for every customer.
                temperature=0.2,
                max_tokens=400,
            ),
        )
    logger.info(f"LLM: {LLM_PROVIDER} ({SARVAM_LLM_MODEL if LLM_PROVIDER != 'gemini' else MODEL})")

    # Tool functions are registered after `task` is created (below) because
    # the handler closes over it for the try_on_frame server-message push.

    # Set once the FlowManager exists (below); read by the turn strategy.
    flow_ref: dict = {}

    def _awaiting_number(text: str) -> bool:
        """Lead step asks for name AND number: a turn with the name but
        fewer than 10 digits is held briefly for the number to follow."""
        fm = flow_ref.get("fm")
        if not fm or fm.current_node != "lead":
            return False
        if re.search(r"नहीं|नही|\bnahi|\bno\b|मत", text, re.I):
            return False  # declining to share
        return len(re.sub(r"\D", "", text)) < 10

    context = LLMContext(messages=[])
    context_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            user_turn_strategies=UserTurnStrategies(
                # Word-count gated, not Sarvam-VAD gated: a strategy list is a
                # race (first to fire wins), so pairing this with an external/
                # VAD-triggered start strategy wouldn't actually require both —
                # the VAD one would just fire first on any noise. Gating on
                # transcribed word count is what actually filters ambient shop
                # chatter per PART2_PLAN.md's noisy-kiosk concern.
                #
                # min_words applies ONLY while the bot is speaking (barge-in
                # gate); when the bot is silent the threshold is hardwired to
                # 1 word. Keep this at 2 — at 3, legitimate short answers like
                # "haan karwao" (2 words) were verified to be dropped mid
                # bot-speech and the transcript never reached the LLM.
                start=[MinWordsUserTurnStartStrategy(min_words=2, use_interim=True)],
                # Driven by the UserStoppedSpeakingFrame Sarvam's vad_signals
                # produces on END_SPEECH (see stt.Settings above), but held
                # up to 2 s when the transcript stops mid-sentence ("मेरा
                # बजट है लगभग…") — turn_completion.py. Measured on Hindi
                # clips (eval_turn.py): 100 % of finished sentences pass
                # without delay, 80 % of mid-sentence pauses are held; the
                # Smart Turn v3 audio model scored 75 % / 65 % on the same.
                stop=[HindiAwareTurnStopStrategy(timeout=0.1, wait_for_transcript=True, hold_s=2.0,
                                                 extra_incomplete=_awaiting_number)],
            ),
            # "Indian speakers often pause mid-sentence" (system_prompt.txt) —
            # this is the knob that actually enforces patience for that.
            user_turn_stop_timeout=3.0,
            # Wired to the SILENCE behaviour already in system_prompt.txt.
            user_idle_timeout=12.0,
        ),
    )

    if text_mode:
        # Typed turns arrive as RTVI send-text (appended to the context, LLM
        # run straight away); replies leave as captions. No STT, no
        # TranscriptGate (nothing to gate), no spoken filler — the page shows
        # its own "typing" cue while the LLM works.
        processors = [
            transport.input(),
            context_aggregator.user(),
            llm,
            CaptionOnlyTTS(),
            transport.output(),
            CaptionSpeakingMarker(),
            context_aggregator.assistant(),
        ]
    else:
        processors = [
            transport.input(),
            stt,
            TranscriptGate(),
            context_aggregator.user(),
            llm,
            ThinkingFiller(),
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    pipeline = Pipeline(processors)

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,  # time-to-first-audio — see PART2_PLAN.md exit gate
            enable_usage_metrics=True,
        ),
        # pipecat 1.12 auto-attaches RTVIProcessor + RTVIObserver here
        # (enable_rtvi defaults to on) — that's what sends the "bot-ready"
        # message PipecatClient.connect() waits for, plus transcripts and
        # our RTVIServerMessageFrame server-messages to the browser.
    )

    # The conversation is a Flows state machine (flow.py): fixed lines,
    # per-stage tools, and the try-on push as a node action instead of an
    # LLM promise.
    store_flow = StoreFlow(_make_ui_pusher(task), text_mode=text_mode)
    flow_manager = FlowManager(
        llm=llm,
        context_aggregator=context_aggregator,
        worker=task,
        transport=transport,
        global_functions=store_flow.global_functions(),
    )
    store_flow.register(flow_manager)
    flow_ref["fm"] = flow_manager

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Customer connected")
        # The greeting is the first node's fixed tts_say pre-action.
        await flow_manager.initialize(store_flow.greet_node())

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Customer disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
    await runner.run(task)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
