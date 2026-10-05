"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PipecatClient, type BotLLMTextData, type TranscriptData } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";

export type VoiceStatus = "idle" | "connecting" | "connected" | "error";

export type TryOnSuggestion = {
  kind: "try_on_frame";
  sku: string;
  name: string;
  brand: string;
  frameId: string;
  variantId: string;
};

export type TranscriptLine = {
  id: number;
  role: "user" | "bot";
  text: string;
};

/** Default endpoint for bot.py's SmallWebRTC offer route. */
const DEFAULT_OFFER_ENDPOINT = "http://localhost:7860/api/offer";

export type UseVoiceAgentOptions = {
  endpoint?: string;
  /**
   * Fired when the agent calls try_on_frame. The try-on page uses this to
   * put the frame on the live face immediately — no navigation, the WebRTC
   * session and mic stay up.
   */
  onTryOnFrame?: (suggestion: TryOnSuggestion) => void;
};

export function useVoiceAgent(options: UseVoiceAgentOptions = {}) {
  const endpoint =
    options.endpoint ??
    process.env.NEXT_PUBLIC_VOICE_AGENT_URL ??
    DEFAULT_OFFER_ENDPOINT;
  const onTryOnFrameRef = useRef(options.onTryOnFrame);
  onTryOnFrameRef.current = options.onTryOnFrame;
  const clientRef = useRef<PipecatClient | null>(null);
  const lineIdRef = useRef(0);
  const botBufferRef = useRef("");
  const botLineIdRef = useRef<number | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<TryOnSuggestion[]>([]);
  /** SKU currently shown on the face by the agent (last try_on_frame). */
  const [activeSku, setActiveSku] = useState<string | null>(null);
  const [botSpeaking, setBotSpeaking] = useState(false);

  const releaseAudio = useCallback(() => {
    for (const el of audioElsRef.current) {
      el.srcObject = null;
      el.remove();
    }
    audioElsRef.current = [];
  }, []);

  const connect = useCallback(async () => {
    if (clientRef.current) return;
    setStatus("connecting");
    setErrorMessage(null);
    botBufferRef.current = "";

    const transport = new SmallWebRTCTransport();
    const client = new PipecatClient({
      transport,
      enableMic: true,
      enableCam: false,
      callbacks: {
        onConnected: () => setStatus("connected"),
        onDisconnected: () => {
          clientRef.current = null;
          releaseAudio();
          setStatus("idle");
        },
        onError: (msg) => {
          const data = msg.data as Record<string, unknown> | string | undefined;
          const text =
            typeof data === "string"
              ? data
              : data?.error ?? data?.message ?? (data ? JSON.stringify(data) : null);
          const fatal = typeof data === "object" && data?.fatal === true;
          setErrorMessage(text ? String(text) : "Voice agent error");
          // Non-fatal pipeline errors (e.g. one LLM call failing) leave the
          // call, mic and audio up — keep "connected" so the UI doesn't lie.
          setStatus((prev) => (prev === "connected" && !fatal ? prev : "error"));
        },
        onBotStartedSpeaking: () => setBotSpeaking(true),
        onBotStoppedSpeaking: () => setBotSpeaking(false),
        // The bot's audio arrives as a remote WebRTC track — the transport
        // emits it but nothing plays it until we attach it to an <audio>.
        onTrackStarted: (track: MediaStreamTrack) => {
          if (track.kind !== "audio") return;
          const el = document.createElement("audio");
          el.autoplay = true;
          el.setAttribute("playsinline", "true");
          el.srcObject = new MediaStream([track]);
          audioElsRef.current.push(el);
          el.play().catch((e) =>
            setErrorMessage(`Browser blocked audio playback: ${e.message}`),
          );
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
          if (!data.final || !data.text?.trim()) return;
          // New turn — seal the bot's last reply.
          botBufferRef.current = "";
          botLineIdRef.current = null;
          const id = ++lineIdRef.current;
          setTranscript((t) => [...t, { id, role: "user", text: data.text.trim() }]);
        },
        // LLM text arrives as raw token chunks whose boundaries are NOT word
        // boundaries ("Z" + "aroor"); tokens carry their own leading spaces,
        // so concatenate verbatim. One transcript line per bot turn: the line
        // id is allocated OUTSIDE the state updater (React runs updaters
        // twice in dev, which previously forked a new line per chunk).
        onBotLlmText: (data: BotLLMTextData) => {
          if (!data.text) return;
          botBufferRef.current += data.text;
          const current = botBufferRef.current;
          if (botLineIdRef.current == null) {
            botLineIdRef.current = ++lineIdRef.current;
          }
          const lineId = botLineIdRef.current;
          setTranscript((t) => {
            const idx = t.findIndex((l) => l.id === lineId);
            if (idx >= 0) {
              const next = t.slice();
              next[idx] = { ...t[idx], text: current };
              return next;
            }
            return [...t, { id: lineId, role: "bot", text: current }];
          });
        },
        onServerMessage: (data: unknown) => {
          const msg = data as Partial<TryOnSuggestion> | null;
          if (msg?.kind !== "try_on_frame") return;
          const suggestion = msg as TryOnSuggestion;
          setSuggestions((s) =>
            s.some((x) => x.sku === suggestion.sku) ? s : [...s, suggestion],
          );
          setActiveSku(suggestion.sku);
          onTryOnFrameRef.current?.(suggestion);
        },
      },
    });

    clientRef.current = client;
    try {
      await client.connect({ webrtcRequestParams: { endpoint } });
    } catch (e) {
      clientRef.current = null;
      setStatus("error");
      setErrorMessage(e instanceof Error ? e.message : "Could not reach the voice agent");
      try {
        await client.disconnect();
      } catch {
        // already failed — nothing to clean up
      }
    }
  }, [endpoint]);

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
    setStatus("idle");
  }, [releaseAudio]);

  // Leave no live WebRTC connection (or held mic) behind on unmount.
  useEffect(() => {
    return () => {
      void clientRef.current?.disconnect();
      clientRef.current = null;
      releaseAudio();
    };
  }, [releaseAudio]);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setActiveSku(null);
  }, []);

  return {
    status,
    errorMessage,
    transcript,
    suggestions,
    activeSku,
    setActiveSku,
    botSpeaking,
    connect,
    disconnect,
    clearSuggestions,
  };
}
