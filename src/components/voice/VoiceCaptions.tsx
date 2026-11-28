"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVoiceStore } from "@/store/voiceStore";
import { useUiStore } from "@/store/uiStore";

/**
 * Split a caption into pages of at most maxChars (≈ two lines), breaking at
 * words and preferring sentence ends (। . ? !) once a page is half full.
 */
export function paginate(text: string, maxChars: number): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  const pages: string[][] = [];
  let page: string[] = [];
  let len = 0;
  for (const w of words) {
    const add = (page.length ? 1 : 0) + w.length;
    if (page.length && len + add > maxChars) {
      pages.push(page);
      page = [];
      len = 0;
    }
    page.push(w);
    len += (page.length > 1 ? 1 : 0) + w.length;
    if (len >= maxChars * 0.5 && /[।.?!]$/.test(w)) {
      pages.push(page);
      page = [];
      len = 0;
    }
  }
  if (page.length) pages.push(page);
  return pages;
}

/** How long a page stays up before the next one: reading time, 2.2 s minimum. */
function dwellMs(page: string[]): number {
  const chars = page.reduce((n, w) => n + w.length + 1, 0);
  return Math.max(2200, chars * 60);
}

/**
 * Live subtitles over the mirror. While the customer talks: their words as
 * STT hears them (pale, so they can see they were understood). While the
 * assistant talks: its words, each new word fading in, shown a page (≈ two
 * lines) at a time so a long reply is read from the start, not cut to its tail.
 *
 * Voice mode: fades out a few seconds after the last line (the audio carried
 * it). Text mode: captions ARE the reply, so the last one stays until the
 * customer answers.
 */
export function VoiceCaptions() {
  const phase = useVoiceStore((s) => s.phase);
  const userInterim = useVoiceStore((s) => s.userInterim);
  const botCaption = useVoiceStore((s) => s.botCaption);
  const lastUser = useVoiceStore((s) => {
    for (let i = s.transcript.length - 1; i >= 0; i--) if (s.transcript[i].role === "user") return s.transcript[i];
    return null;
  });
  const textMode = useUiStore((s) => s.inputMode === "text");
  const [visible, setVisible] = useState(false);
  // Phones: the mirror is short, so pages are shorter and sit low — the face
  // must stay visible while the assistant announces the frame on it.
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
  // Text mode: the customer's message shows only until the reply's first
  // words arrive; from then the reply stays, whatever the phase does in
  // between (a brief flip back to "thinking" used to flash their text again).
  const showUser = textMode ? !botCaption && (userTalking || phase === "thinking") : userTalking || phase === "thinking";
  const userText = userInterim || (phase === "thinking" ? lastUser?.text ?? "" : "");
  const text = showUser ? userText : botCaption;
  const thinking = phase === "thinking";

  const pages = useMemo(() => paginate(text, narrow ? 60 : 110), [text, narrow]);

  // Page through the bot's reply at reading speed. A new reply (caption
  // cleared, or switching speaker) starts again at page 1. The customer's
  // own words always show their latest page.
  const [pageIdx, setPageIdx] = useState(0);
  const turnKey = `${showUser ? "u" : "b"}`;
  const prevTurn = useRef(turnKey);
  const prevLen = useRef(0);
  useEffect(() => {
    if (prevTurn.current !== turnKey || text.length < prevLen.current) setPageIdx(0);
    prevTurn.current = turnKey;
    prevLen.current = text.length;
  }, [turnKey, text]);
  const lastPage = Math.max(0, pages.length - 1);
  const shownIdx = showUser ? lastPage : Math.min(pageIdx, lastPage);
  useEffect(() => {
    if (showUser || shownIdx >= lastPage) return;
    const id = setTimeout(() => setPageIdx((i) => i + 1), dwellMs(pages[shownIdx] ?? []));
    return () => clearTimeout(id);
  }, [showUser, shownIdx, lastPage, pages]);

  useEffect(() => {
    if (text || thinking) {
      setVisible(true);
      if (phase === "speaking" || phase === "user" || thinking) return;
      // Text mode: the reply stays readable until the customer answers.
      if (textMode && phase !== "off") return;
    }
    const id = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(id);
  }, [text, phase, thinking, textMode]);

  if (phase === "off" && !text) return null;
  if (!text && !thinking) return null;

  // Absolute word index of this page's first word — keys keep earlier words'
  // nodes (no re-animation) while newly appended words mount and fade in.
  const offset = pages.slice(0, shownIdx).reduce((n, p) => n + p.length, 0);
  const words = pages[shownIdx] ?? [];
  const more = !showUser && shownIdx < lastPage;

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-40 flex flex-col items-center gap-2 px-3 transition-opacity duration-500 sm:px-6 ${
        textMode ? "bottom-[9.25rem] sm:bottom-[8.5rem]" : "bottom-[8.25rem] sm:bottom-[9.75rem]"
      } ${visible ? "opacity-100" : "opacity-0"}`}
      aria-live="polite"
    >
      {text ? (
        <p
          className={`caption-text max-w-2xl px-3 text-center text-sm leading-snug sm:px-5 sm:text-xl ${
            showUser ? "font-medium italic opacity-85" : "font-semibold"
          }`}
        >
          {showUser ? (
            <span className="mr-1.5 align-middle text-xs font-semibold not-italic text-indigo-200 sm:text-sm">आप</span>
          ) : null}
          {showUser && shownIdx > 0 ? "… " : null}
          {words.map((w, i) => (
            <span key={`${turnKey}-${offset + i}`} className="caption-word">
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
          {more ? <span className="ml-1 align-middle opacity-70" aria-hidden>›</span> : null}
        </p>
      ) : null}
    </div>
  );
}
