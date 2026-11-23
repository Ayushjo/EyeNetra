"use client";

import { useEffect, useState } from "react";
import { useVoiceStore } from "@/store/voiceStore";

/**
 * Index of the first word to show so the caption stays within maxChars —
 * captions show the tail, like live subtitles.
 */
function tailStart(words: string[], maxChars: number): number {
  let len = 0;
  for (let i = words.length - 1; i >= 0; i--) {
    len += words[i].length + 1;
    if (len > maxChars) return i + 1;
  }
  return 0;
}

/**
 * Live subtitles over the mirror. While the customer talks: their words as
 * STT hears them (pale, so they can see they were understood). While the
 * assistant talks: its words as TTS speaks them, each new word fading in.
 * Fades out a few seconds after the last line.
 */
export function VoiceCaptions() {
  const phase = useVoiceStore((s) => s.phase);
  const userInterim = useVoiceStore((s) => s.userInterim);
  const botCaption = useVoiceStore((s) => s.botCaption);
  const lastUser = useVoiceStore((s) => {
    for (let i = s.transcript.length - 1; i >= 0; i--) if (s.transcript[i].role === "user") return s.transcript[i];
    return null;
  });
  const [visible, setVisible] = useState(false);
  // Phones: the mirror is short, so captions keep only the newest words
  // (≈2 lines) and sit low — the face must stay visible while the
  // assistant announces the frame on it.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const userTalking = phase === "user" || (phase === "thinking" && !!userInterim);
  // Thinking without interim: keep showing what we heard, so the customer
  // can check it while the assistant works.
  const showUser = userTalking || phase === "thinking";
  const userText = userInterim || (phase === "thinking" ? lastUser?.text ?? "" : "");
  const text = showUser ? userText : botCaption;

  useEffect(() => {
    if (text) {
      setVisible(true);
      if (phase === "speaking" || phase === "user" || phase === "thinking") return;
    }
    const id = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(id);
  }, [text, phase]);

  if (phase === "off" || !text) return null;
  const all = text.split(" ");
  const start = tailStart(all, narrow ? 56 : 110);
  const words = all.slice(start);

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-[8.25rem] z-40 flex justify-center px-3 transition-opacity duration-500 sm:bottom-[10.5rem] sm:px-6 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      aria-live="polite"
    >
      <p
        className={`max-w-2xl rounded-xl px-3 py-1.5 text-center text-sm leading-snug shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-md sm:rounded-2xl sm:px-5 sm:py-3 sm:text-2xl ${
          showUser
            ? "bg-white/60 italic text-zinc-600"
            : "bg-white/85 font-medium text-zinc-900"
        }`}
      >
        {showUser ? (
          <span className="mr-2 align-middle text-sm not-italic text-indigo-500">
            आप
          </span>
        ) : null}
        {start > 0 ? "… " : null}
        {words.map((w, i) => (
          // Key by absolute word position: earlier words keep their node (no
          // re-animation), the newly appended word mounts and fades in.
          <span key={`${showUser ? "u" : "b"}-${start + i}`} className="caption-word">
            {w}{i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </p>
    </div>
  );
}
