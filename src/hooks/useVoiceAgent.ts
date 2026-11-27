"use client";

import { useCallback, useEffect, useRef } from "react";
import { PipecatClient, type BotTTSTextData, type TranscriptData } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import {
  useVoiceStore,
  voiceLevels,
  type KioskSession,
  type TranscriptLine,
  type TryOnSuggestion,
} from "@/store/voiceStore";

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
  const botStoppedAtRef = useRef(0);
  const lastBotTextAtRef = useRef(0);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const metersRef = useRef<(() => void)[]>([]);

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
    set({
      status: "connecting",
      phase: "connecting",
      dropped: false,
      errorMessage: null,
      userInterim: "",
      botCaption: "",
      ended: false,
    });
    botLineIdRef.current = null;

    const pushLine = (role: TranscriptLine["role"], text: string) => {
      const id = ++lineIdRef.current;
      set((s) => ({ transcript: [...s.transcript, { id, role, text }] }));
      return id;
    };

    const transport = new SmallWebRTCTransport();
    const client = new PipecatClient({
      transport,
      enableMic: true,
      enableCam: false,
      callbacks: {
        onConnected: () => {
          set({ status: "connected", phase: "listening" });
          const mic = client.tracks().local.audio;
          if (mic) meter(mic, "mic");
        },
        onDisconnected: () => {
          // disconnect() clears clientRef first; if it is still set, the
          // other side hung up on us (bot crash, service out of credit…).
          const dropped = clientRef.current === client;
          clientRef.current = null;
          releaseAudio();
          set({ status: "idle", phase: "off", userInterim: "", ...(dropped ? { dropped: true } : {}) });
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
        onUserStartedSpeaking: () => set({ phase: "user" }),
        onUserStoppedSpeaking: () =>
          set((s) => (s.phase === "user" ? { phase: "thinking" } : {})),
        onBotStartedSpeaking: () => set({ phase: "speaking" }),
        onBotStoppedSpeaking: () => {
          botStoppedAtRef.current = performance.now();
          set((s) => (s.phase === "speaking" ? { phase: "listening" } : {}));
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
          // A new bot turn without a customer line in between (e.g. after a
          // tap on the screen): start a fresh caption instead of appending.
          const now = performance.now();
          if (
            botLineIdRef.current != null &&
            botStoppedAtRef.current > lastBotTextAtRef.current &&
            now - botStoppedAtRef.current > 400
          ) {
            botLineIdRef.current = null;
          }
          lastBotTextAtRef.current = now;
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
          } else if (msg?.kind === "session") {
            const { kind: _k, ...session } = msg as unknown as KioskSession & { kind: string };
            void _k;
            set((s) => ({
              session,
              ended: session.ended,
              // The bot's shortlist is the source of truth for hearts.
              picks: session.shortlist,
              likeSeq: session.shortlist.length > s.picks.length ? s.likeSeq + 1 : s.likeSeq,
            }));
          }
        },
      },
    });

    clientRef.current = client;
    try {
      await client.connect({ webrtcRequestParams: { endpoint } });
    } catch (e) {
      clientRef.current = null;
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
  }, [endpoint, meter, releaseAudio]);

  const disconnect = useCallback(async () => {
    const client = clientRef.current;
    clientRef.current = null;
    releaseAudio();
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // best-effort disconnect
      }
    }
    useVoiceStore.setState({ status: "idle", phase: "off", userInterim: "" });
  }, [releaseAudio]);

  const send = useCallback((type: string, data: unknown) => {
    const client = clientRef.current;
    if (!client || useVoiceStore.getState().status !== "connected") return false;
    try {
      client.sendClientMessage(type, data);
      return true;
    } catch (e) {
      console.warn(`[EyeNetra:voice] could not send ${type}`, e);
      return false;
    }
  }, []);

  // Expose connect/disconnect/actions to every component through the store.
  useEffect(() => {
    useVoiceStore.setState({
      connect: () => void connect(),
      disconnect: () => void disconnect(),
      sendAction: (name, args) => {
        send("action", { name, args: args ?? {} });
      },
      requestStaff: () => {
        // With the AI live, it says one line and steps back (flow.py
        // handoff). Without it, the kiosk hands off on its own.
        if (!send("handoff", { source: "button" })) {
          useVoiceStore.setState({ localHandoff: { reason: "customer_button" } });
        }
      },
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

/** Clear everything for the next customer. */
export function resetVoiceSession() {
  useVoiceStore.setState({
    transcript: [],
    suggestions: [],
    activeSku: null,
    picks: [],
    userInterim: "",
    botCaption: "",
    ended: false,
    session: null,
    dropped: false,
    localHandoff: null,
    staff: {},
    errorMessage: null,
  });
}
