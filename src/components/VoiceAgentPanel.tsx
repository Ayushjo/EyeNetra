"use client";

import { useEffect, useRef, useState } from "react";
import { resetVoiceSession, useVoiceAgent } from "@/hooks/useVoiceAgent";
import { useVoiceStore } from "@/store/voiceStore";
import { DEFAULT_INPUT_MODE, useUiStore } from "@/store/uiStore";
import { sfx } from "@/lib/sfx";
import { FrameGlyph } from "@/components/voice/FrameGlyph";
import {
  formatRupees,
  friendlyError,
  showSuggestionOnFace,
} from "@/components/voice/VoiceStageOverlay";

/**
 * Runs the page's one voice session (mount once). The WebRTC call, mic, bot
 * audio and transcript stay alive while frames change on the live face: a
 * try_on_frame message from the agent selects the frame in the try-on store
 * directly — no navigation, no confirmation step.
 */
export function VoiceSession() {
  useVoiceAgent({ onTryOnFrame: showSuggestionOnFace });
  // Sound cues, from store transitions (one place, whatever caused them).
  useEffect(
    () =>
      useVoiceStore.subscribe((s, prev) => {
        if (s.status === "connected" && prev.status !== "connected") sfx.connect();
        if (s.status === "idle" && prev.status === "connected") sfx.end();
        if (s.dropSeq > prev.dropSeq) sfx.drop();
        if (s.likeSeq > prev.likeSeq) sfx.like();
      }),
    [],
  );
  return null;
}

/** "Your picks": frames the customer liked. Tap to try one on again. */
function PicksTray() {
  const suggestions = useVoiceStore((s) => s.suggestions);
  const picks = useVoiceStore((s) => s.picks);
  const liked = suggestions.filter((s) => picks.includes(s.sku));
  if (liked.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
        आपकी पसंद · Your picks
      </p>
      <div className="flex flex-wrap gap-2">
        {liked.map((s) => (
          <button
            key={s.sku}
            type="button"
            onClick={() => showSuggestionOnFace(s)}
            className="flex items-center gap-3 rounded-xl border border-rose-400/30 bg-zinc-950 px-3 py-2 text-left transition hover:border-rose-400/60"
          >
            <FrameGlyph shape={s.shape} color="#d4d4d8" className="h-7 w-14" />
            <span className="leading-tight">
              <span className="block text-sm font-medium text-zinc-100">{s.name}</span>
              <span className="block text-xs text-zinc-400">
                {s.brand} {s.price != null ? `· ${formatRupees(s.price)}` : ""}
              </span>
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-rose-400" fill="currentColor" aria-label="पसंद">
              <path d="M12 21s-7.5-4.9-9.8-9.2C.6 8.6 2.4 5.4 5.6 5.4c1.9 0 3.4 1 4.3 2.5L12 10.6l2.1-2.7c.9-1.5 2.4-2.5 4.3-2.5 3.2 0 5 3.2 3.4 6.4C19.5 16.1 12 21 12 21Z" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Shown when the conversation ends: what they saw, what they liked. */
function SessionSummary() {
  const ended = useVoiceStore((s) => s.ended);
  const suggestions = useVoiceStore((s) => s.suggestions);
  const picks = useVoiceStore((s) => s.picks);
  const disconnect = useVoiceStore((s) => s.disconnect);
  if (!ended || suggestions.length === 0) return null;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-base font-semibold text-zinc-100">धन्यवाद</p>
      <p className="mt-1 text-sm text-zinc-400">
        आपने {suggestions.length} फ्रेम देखे
        {picks.length ? `, ${picks.length} पसंद आए` : ""}। हमारे executive आपकी मदद करेंगे।
      </p>
      <button
        type="button"
        onClick={() => {
          disconnect();
          resetVoiceSession();
          useUiStore.getState().setInputMode(DEFAULT_INPUT_MODE);
        }}
        className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
      >
        नया ग्राहक · Next customer
      </button>
    </div>
  );
}

const STATUS_TEXT = {
  idle: "बंद",
  connecting: "जुड़ रहे हैं…",
  connected: "चालू",
  error: "रुकावट",
} as const;

/**
 * The session card under the mirror: status, the customer's picks, the end
 * summary, and the full conversation in a collapsible drawer (the live line
 * is already captioned on the mirror itself). Starting and ending the
 * conversation happens on the mirror — one place, not two.
 */
export function VoiceAgentPanel() {
  const status = useVoiceStore((s) => s.status);
  const phase = useVoiceStore((s) => s.phase);
  const errorMessage = useVoiceStore((s) => s.errorMessage);
  const transcript = useVoiceStore((s) => s.transcript);
  const staffMode = useUiStore((s) => s.staffMode);
  const textMode = useUiStore((s) => s.inputMode === "text");
  const [open, setOpen] = useState(false);

  // Scroll the transcript box itself — scrollIntoView would scroll the whole
  // page away from the mirror on every new line.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [transcript, open]);

  const connected = status === "connected";
  const dot =
    phase === "speaking" || phase === "user"
      ? "bg-indigo-400 animate-pulse"
      : phase === "thinking"
        ? "bg-violet-400 animate-pulse"
        : connected
          ? "bg-emerald-400"
          : status === "error"
            ? "bg-rose-500"
            : "bg-zinc-600";

  return (
    <section id="voice" className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4">
      <div className="flex items-center gap-3">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">
            सहायक · Assistant
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {STATUS_TEXT[status]} · {textMode ? "लिखकर" : "आवाज़ से"}
            </span>
          </p>
          {errorMessage ? (
            <p className="text-xs text-rose-400">
              {friendlyError(errorMessage)}
              {staffMode ? <span className="ml-2 text-zinc-500">({errorMessage})</span> : null}
            </p>
          ) : (
            <p className="text-xs text-zinc-500">
              {connected
                ? textMode
                  ? "नीचे से चुनिए या लिखिए — फ्रेम सीधे आपके चेहरे पर दिखेंगे।"
                  : "हिंदी, Hinglish या English में बोलिए — फ्रेम सीधे आपके चेहरे पर दिखेंगे।"
                : textMode
                  ? "शीशे पर नीचे लिखकर बातचीत शुरू करें।"
                  : "शीशे पर गोले को छूकर बातचीत शुरू करें।"}
            </p>
          )}
        </div>
      </div>

      <SessionSummary />
      <PicksTray />

      <div className="rounded-xl border border-zinc-800">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500 transition hover:text-zinc-300"
        >
          <span>बातचीत · Conversation · {transcript.length}</span>
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </button>
        {open ? (
          <div ref={boxRef} className="flex max-h-72 flex-col gap-2 overflow-y-auto border-t border-zinc-800 px-4 py-3">
            {transcript.length === 0 ? (
              <p className="text-sm text-zinc-500">बातचीत यहाँ दिखेगी।</p>
            ) : (
              transcript.map((line) => (
                <p
                  key={line.id}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    line.role === "user"
                      ? "self-end bg-indigo-500/20 text-indigo-50"
                      : "self-start border border-zinc-800 bg-zinc-950 text-zinc-200"
                  }`}
                >
                  {line.text}
                </p>
              ))
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
