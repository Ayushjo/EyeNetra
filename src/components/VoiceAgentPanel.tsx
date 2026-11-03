"use client";

import { useEffect, useRef, useState } from "react";
import { resetVoiceSession, useVoiceAgent } from "@/hooks/useVoiceAgent";
import { useVoiceStore } from "@/store/voiceStore";
import { sfx } from "@/lib/sfx";
import { FrameGlyph } from "@/components/voice/FrameGlyph";
import { formatRupees, showSuggestionOnFace } from "@/components/voice/VoiceStageOverlay";

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

/** "Your picks": frames the customer liked, with a total. */
function PicksTray() {
  const suggestions = useVoiceStore((s) => s.suggestions);
  const picks = useVoiceStore((s) => s.picks);
  const liked = suggestions.filter((s) => picks.includes(s.sku));
  if (liked.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-amber-200/80">
        आपकी पसंद · Your picks
      </p>
      <div className="flex flex-wrap gap-2">
        {liked.map((s) => (
          <button
            key={s.sku}
            type="button"
            onClick={() => showSuggestionOnFace(s)}
            className="flex items-center gap-3 rounded-xl border border-amber-200/30 bg-amber-200/10 px-3 py-2 text-left transition hover:bg-amber-200/20"
          >
            <FrameGlyph shape={s.shape} color="#fcd9a0" className="h-7 w-14" />
            <span className="leading-tight">
              <span className="block text-sm font-medium text-white">{s.name}</span>
              <span className="block text-xs text-white/60">
                {s.brand} {s.price != null ? `· ${formatRupees(s.price)}` : ""}
              </span>
            </span>
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
    <div className="rounded-2xl border border-teal-300/20 bg-gradient-to-br from-teal-400/10 to-amber-300/10 p-4">
      <p className="text-base font-semibold text-white">धन्यवाद! 🙏</p>
      <p className="mt-1 text-sm text-white/70">
        आपने {suggestions.length} फ्रेम देखे
        {picks.length ? `, ${picks.length} पसंद आए` : ""}. हमारे executive आपकी मदद करेंगे।
      </p>
      <button
        type="button"
        onClick={() => {
          disconnect();
          resetVoiceSession();
        }}
        className="mt-3 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
      >
        नया ग्राहक · Next customer
      </button>
    </div>
  );
}

/**
 * The session card under the mirror: status, the customer's picks, the end
 * summary, and the full conversation in a collapsible drawer (the live line
 * is already captioned on the mirror itself).
 */
export function VoiceAgentPanel() {
  const status = useVoiceStore((s) => s.status);
  const phase = useVoiceStore((s) => s.phase);
  const errorMessage = useVoiceStore((s) => s.errorMessage);
  const transcript = useVoiceStore((s) => s.transcript);
  const connect = useVoiceStore((s) => s.connect);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const [open, setOpen] = useState(false);

  // Scroll the transcript box itself — scrollIntoView would scroll the whole
  // page away from the mirror on every new line.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [transcript, open]);

  const connected = status === "connected";
  const busy = status === "connecting";
  const dot =
    phase === "speaking"
      ? "bg-amber-300 animate-pulse"
      : phase === "thinking"
        ? "bg-violet-400 animate-pulse"
        : phase === "user"
          ? "bg-teal-300 animate-pulse"
          : connected
            ? "bg-teal-400"
            : status === "error"
              ? "bg-red-500"
              : "bg-zinc-500";

  return (
    <section
      id="voice"
      className="space-y-4 rounded-2xl border border-white/10 bg-zinc-950 p-4 text-white shadow-xl"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
          <div>
            <p className="text-sm font-medium">
              Eyenetra assistant
              <span className="ml-2 text-white/50">
                {busy ? "connecting…" : connected ? "live" : status === "error" ? "error" : "off"}
              </span>
            </p>
            {errorMessage ? (
              <p className="text-xs text-red-400">{errorMessage}</p>
            ) : (
              <p className="text-xs text-white/50">
                {connected
                  ? "हिंदी, Hinglish या English में बोलिए — फ्रेम सीधे आपके चेहरे पर दिखेंगे।"
                  : "Tap the orb on the mirror, or here, and allow the microphone."}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => (connected ? disconnect() : connect())}
          disabled={busy}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
            connected ? "bg-white/10 hover:bg-white/20" : "bg-teal-400 text-zinc-950 hover:bg-teal-300"
          }`}
        >
          {busy ? "Connecting…" : connected ? "End" : "Talk"}
        </button>
      </div>

      <SessionSummary />
      <PicksTray />

      <div className="rounded-xl border border-white/10">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-white/50"
        >
          <span>Conversation · {transcript.length}</span>
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </button>
        {open ? (
          <div ref={boxRef} className="flex max-h-64 flex-col gap-2 overflow-y-auto border-t border-white/10 px-4 py-3">
            {transcript.length === 0 ? (
              <p className="text-sm text-white/40">The conversation will appear here.</p>
            ) : (
              transcript.map((line) => (
                <p
                  key={line.id}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    line.role === "user"
                      ? "self-end bg-teal-400/15 text-teal-50"
                      : "self-start bg-white/5 text-white"
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
