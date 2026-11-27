"use client";

import { useCallback, useEffect, useRef } from "react";
import { PipecatClient, type BotTTSTextData, type TranscriptData } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import {
  useVoiceStore,
  voiceLevels,
  type ConversationStage,
  type TranscriptLine,
  type TryOnSuggestion,
} from "@/store/voiceStore";
import { useUiStore } from "@/store/uiStore";

export type { TranscriptLine, TryOnSuggestion, VoiceStatus } from "@/store/voiceStore";

/** Default endpoint for bot.py's SmallWebRTC offer route. */
const DEFAULT_OFFER_ENDPOINT = "http://localhost:7860/api/offer";

export type UseVoiceAgentOptions = {
  endpoint?: string;
  /**
   * Fired when the agent shows a frame. The try-on page uses this to put the
   * frame on the live face immediately — no navigation, the WebRTC session
   * and mic stay up.
   */
  onTryOnFrame?: (suggestion: TryOnSuggestion) => void;
};

/**
 * Text mode is chosen per session through the offer URL: bot.py reads the
 * runner's session_id (the runner drops the client's camelCase requestData).
 */
function textModeEndpoint(endpoint: string): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}session_id=text-${id}`;
}

/** Typed text waits at most this long for the greeting to finish. */
const PENDING_TEXT_MAX_WAIT_MS = 6000;

/** Words from successive TTS chunks: chunks carry no reliable spacing. */
function joinSpoken(prev: string, next: string): string {
  const t = next.trim();
  if (!t) return prev;
  if (!prev) return t;
  return /^[।,.!?…]/.test(t) ? prev + t : `${prev} ${t}`;
}

/**
 * Smoothed RMS meter on a MediaStreamTrack. Fast attack, slow release, so
 * the orb jumps with syllables and settles gently between them.
 */
function startMeter(ctx: AudioContext, track: MediaStreamTrack, key: "mic" | "bot"): () => void {
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let raf = 0;
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let ss = 0;
    for (let i = 0; i < buf.length; i++) ss += buf[i] * buf[i];
    // Speech RMS sits around 0.02–0.2; map to 0–1 on a soft curve.
    const level = Math.min(1, Math.sqrt(Math.sqrt(ss / buf.length)) * 1.6);
    const prev = voiceLevels[key];
    voiceLevels[key] = level > prev ? prev + (level - prev) * 0.6 : prev + (level - prev) * 0.08;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    src.disconnect();
    voiceLevels[key] = 0;
  };
}

/**
 * One voice session for the page. State lives in useVoiceStore so the orb,
 * captions and panel (different parts of the tree) all read the same call.
 * Mount once (VoiceSession).
 */
export function useVoiceAgent(options: UseVoiceAgentOptions = {}) {
  const endpoint =
    options.endpoint ??
    process.env.NEXT_PUBLIC_VOICE_AGENT_URL ??
    DEFAULT_OFFER_ENDPOINT;
  const onTryOnFrameRef = useRef(options.onTryOnFrame);
  onTryOnFrameRef.current = options.onTryOnFrame;
  const clientRef = useRef<PipecatClient | null>(null);
  const lineIdRef = useRef(0);
  const botLineIdRef = useRef<number | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const metersRef = useRef<(() => void)[]>([]);
  /** Text typed before the session was ready (sent after the greeting). */
  const pendingTextRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** connect() resolved: the bot answered bot-ready and accepts send-text. */
  const botReadyRef = useRef(false);
  /**
   * The bot finished its first utterance (the greeting). It can finish
   * before the SDK's onConnected fires, so this is tracked on its own.
   */
  const greetedRef = useRef(false);

  const pushLine = useCallback((role: TranscriptLine["role"], text: string) => {
    const id = ++lineIdRef.current;
    useVoiceStore.setState((s) => ({ transcript: [...s.transcript, { id, role, text }] }));
    return id;
  }, []);

  /** Hand typed text to the bot (RTVI send-text → context → LLM). */
  const deliverText = useCallback(async (client: PipecatClient, text: string) => {
    try {
      await client.sendText(text);
    } catch (e) {
      useVoiceStore.setState((s) => ({
        errorMessage: e instanceof Error ? e.message : "Message not sent",
        phase: s.phase === "thinking" ? "listening" : s.phase,
      }));
    }
  }, []);

  /**
   * Send text typed before the session was ready: once the bot is ready and
   * its greeting has finished (so the reply doesn't cut the greeting off), or
   * on `force` (the greeting never came).
   */
  const flushPending = useCallback((force = false) => {
    const text = pendingTextRef.current;
    const client = clientRef.current;
    if (!text || !client || !botReadyRef.current) return;
    if (!greetedRef.current && !force) return;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    pendingTextRef.current = null;
    botLineIdRef.current = null;
    pushLine("user", text);
    // botCaption cleared: the greeting stops showing once their message is sent.
    useVoiceStore.setState({ phase: "thinking", userInterim: "", botCaption: "" });
    void deliverText(client, text);
  }, [deliverText, pushLine]);

  const releaseAudio = useCallback(() => {
    for (const el of audioElsRef.current) {
      el.srcObject = null;
      el.remove();
    }
    audioElsRef.current = [];
    for (const stop of metersRef.current) stop();
    metersRef.current = [];
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  const meter = useCallback((track: MediaStreamTrack, key: "mic" | "bot") => {
    try {
      const ctx = (audioCtxRef.current ??= new AudioContext());
      void ctx.resume();
      metersRef.current.push(startMeter(ctx, track, key));
    } catch (e) {
      console.warn("[EyeNetra:voice] audio meter unavailable", e);
    }
  }, []);

  const connect = useCallback(async () => {
    if (clientRef.current) return;
    const set = useVoiceStore.setState;
    const textMode = useUiStore.getState().inputMode === "text";
    set({
      status: "connecting",
      // A message typed before connecting already shows "thinking".
      phase: pendingTextRef.current ? "thinking" : "connecting",
      errorMessage: null,
      // A message typed before connecting stays on screen until it is sent.
      userInterim: pendingTextRef.current ?? "",
      botCaption: "",
      ended: false,
      stage: null,
    });
    botLineIdRef.current = null;
    botReadyRef.current = false;
    greetedRef.current = false;

    const transport = new SmallWebRTCTransport();
    const client = new PipecatClient({
      transport,
      // Text mode never asks for the microphone.
      enableMic: !textMode,
      enableCam: false,
      callbacks: {
        onConnected: () => {
          set((s) => ({ status: "connected", phase: s.phase === "thinking" ? "thinking" : "listening" }));
          const mic = client.tracks().local.audio;
          if (mic) meter(mic, "mic");
        },
        onDisconnected: () => {
          clientRef.current = null;
          pendingTextRef.current = null;
          botReadyRef.current = false;
          releaseAudio();
          // A new session starts from the greeting: its quick replies too.
          set({ status: "idle", phase: "off", userInterim: "", stage: null });
        },
        onError: (msg) => {
          const data = msg.data as Record<string, unknown> | string | undefined;
          const text =
            typeof data === "string"
              ? data
              : data?.error ?? data?.message ?? (data ? JSON.stringify(data) : null);
          const fatal = typeof data === "object" && data?.fatal === true;
          // Non-fatal pipeline errors (e.g. one LLM call failing) leave the
          // call, mic and audio up — keep "connected" so the UI doesn't lie.
          set((s) =>
            s.status === "connected" && !fatal
              ? { errorMessage: text ? String(text) : "Voice agent error" }
              : { errorMessage: text ? String(text) : "Voice agent error", status: "error", phase: "error" },
          );
        },
        // No mic in text mode: "user speaking" events there mean nothing
        // and would flip the phase (and the captions) mid-reply.
        onUserStartedSpeaking: () => {
          if (!textMode) set({ phase: "user" });
        },
        onUserStoppedSpeaking: () =>
          !textMode &&
          set((s) => (s.phase === "user" ? { phase: "thinking" } : {})),
        onBotStartedSpeaking: () => set({ phase: "speaking" }),
        onBotStoppedSpeaking: () => {
          set((s) => (s.phase === "speaking" ? { phase: "listening" } : {}));
          // A message typed while the greeting played goes out once it ends.
          greetedRef.current = true;
          flushPending();
        },
        // The bot's audio arrives as a remote WebRTC track — the transport
        // emits it but nothing plays it until we attach it to an <audio>.
        onTrackStarted: (track: MediaStreamTrack, participant) => {
          if (track.kind !== "audio" || participant?.local) return;
          const el = document.createElement("audio");
          el.autoplay = true;
          el.setAttribute("playsinline", "true");
          el.srcObject = new MediaStream([track]);
          audioElsRef.current.push(el);
          el.play().catch((e) =>
            set({ errorMessage: `Browser blocked audio playback: ${e.message}` }),
          );
          meter(track, "bot");
        },
        onTrackStopped: (track: MediaStreamTrack) => {
          audioElsRef.current = audioElsRef.current.filter((el) => {
            const ms = el.srcObject as MediaStream | null;
            if (ms?.getTracks().includes(track)) {
              el.srcObject = null;
              el.remove();
              return false;
            }
            return true;
          });
        },
        onUserTranscript: (data: TranscriptData) => {
          const text = data.text?.trim() ?? "";
          if (!data.final) {
            if (text) set({ userInterim: text });
            return;
          }
          set({ userInterim: "" });
          if (!text) return;
          // New customer turn — seal the bot's last reply.
          botLineIdRef.current = null;
          pushLine("user", text);
        },
        // What TTS actually speaks — includes the Flows fixed lines
        // (tts_say), which never pass through the LLM, so captions and
        // transcript follow the audio rather than the model's tokens.
        onBotTtsText: (data: BotTTSTextData) => {
          if (!data.text) return;
          if (botLineIdRef.current == null) {
            botLineIdRef.current = pushLine("bot", "");
            set({ botCaption: "" });
          }
          const lineId = botLineIdRef.current;
          set((s) => {
            const idx = s.transcript.findIndex((l) => l.id === lineId);
            const caption = joinSpoken(s.botCaption, data.text);
            if (idx < 0) return { botCaption: caption };
            const transcript = s.transcript.slice();
            transcript[idx] = { ...s.transcript[idx], text: joinSpoken(s.transcript[idx].text, data.text) };
            return { transcript, botCaption: caption };
          });
        },
        onServerMessage: (data: unknown) => {
          const msg = data as { kind?: string; sku?: string } | null;
          if (msg?.kind === "try_on_frame") {
            const suggestion = msg as TryOnSuggestion;
            set((s) => ({
              suggestions: s.suggestions.some((x) => x.sku === suggestion.sku)
                ? s.suggestions.map((x) => (x.sku === suggestion.sku ? suggestion : x))
                : [...s.suggestions, suggestion],
              activeSku: suggestion.sku,
              dropSeq: s.dropSeq + 1,
            }));
            onTryOnFrameRef.current?.(suggestion);
          } else if (msg?.kind === "liked" && msg.sku) {
            const sku = msg.sku;
            set((s) => ({
              picks: s.picks.includes(sku) ? s.picks : [...s.picks, sku],
              likeSeq: s.likeSeq + 1,
            }));
          } else if (msg?.kind === "session_end") {
            set({ ended: true });
          } else if (msg?.kind === "stage") {
            const stage = (msg as { stage?: string }).stage;
            if (stage) set({ stage: stage as ConversationStage });
          }
        },
      },
    });

    clientRef.current = client;
    try {
      await client.connect({
        webrtcRequestParams: { endpoint: textMode ? textModeEndpoint(endpoint) : endpoint },
      });
      botReadyRef.current = true;
      // Typed before connecting: send now if the greeting already finished,
      // else when it does — or after a short wait if it never comes.
      flushPending();
      if (pendingTextRef.current) {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => flushPending(true), PENDING_TEXT_MAX_WAIT_MS);
      }
    } catch (e) {
      clientRef.current = null;
      pendingTextRef.current = null;
      releaseAudio();
      set({
        status: "error",
        phase: "error",
        errorMessage: e instanceof Error ? e.message : "Could not reach the voice agent",
      });
      try {
        await client.disconnect();
      } catch {
        // already failed — nothing to clean up
      }
    }
  }, [endpoint, meter, releaseAudio, pushLine, flushPending]);

  /**
   * A typed message or quick reply. Shown at once as the customer's line;
   * sent now if the session is up, else after connecting and the greeting.
   */
  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const client = clientRef.current;
      if (client && botReadyRef.current && greetedRef.current && !pendingTextRef.current) {
        botLineIdRef.current = null; // seal the bot's previous reply
        pushLine("user", text);
        useVoiceStore.setState({ phase: "thinking", userInterim: "", botCaption: "", errorMessage: null });
        void deliverText(client, text);
        return;
      }
      // Not ready yet: show it as the customer's live line; it joins the
      // transcript when it is actually sent (after the greeting).
      pendingTextRef.current = text;
      useVoiceStore.setState({ phase: "thinking", userInterim: text, errorMessage: null });
      if (!client) void connect();
    },
    [connect, deliverText, pushLine],
  );

  const disconnect = useCallback(async () => {
    const client = clientRef.current;
    clientRef.current = null;
    pendingTextRef.current = null;
    botReadyRef.current = false;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
    releaseAudio();
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // best-effort disconnect
      }
    }
    useVoiceStore.setState({ status: "idle", phase: "off", userInterim: "", stage: null });
  }, [releaseAudio]);

  // Expose connect/disconnect/send to every component through the store.
  useEffect(() => {
    useVoiceStore.setState({
      connect: () => void connect(),
      disconnect: () => void disconnect(),
      send,
    });
  }, [connect, disconnect, send]);

  // Leave no live WebRTC connection (or held mic) behind on unmount.
  useEffect(() => {
    return () => {
      void clientRef.current?.disconnect();
      clientRef.current = null;
      releaseAudio();
    };
  }, [releaseAudio]);
}

/** Clear the shortlist and picks for the next customer. */
export function resetVoiceSession() {
  useVoiceStore.setState({
    transcript: [],
    suggestions: [],
    activeSku: null,
    picks: [],
    userInterim: "",
    botCaption: "",
    ended: false,
    stage: null,
  });
}
