"use client";

import { useEffect, useState } from "react";
import { useVoiceStore, voiceLevels, type ConversationStage } from "@/store/voiceStore";
import { VoiceOrb } from "./VoiceOrb";

/**
 * Quick replies for each step of the conversation (flow.py nodes). They are
 * the answers each step expects, so one tap moves the flow on; the keyboard
 * is there for anything else (budgets, questions, name and number).
 */
const QUICK_REPLIES: Record<ConversationStage | "start", string[]> = {
  start: ["चश्मा चाहिए", "Sunglasses चाहिए", "आँखों की जाँच", "बस देख रहे हैं"],
  greet: ["चश्मा चाहिए", "Sunglasses चाहिए", "आँखों की जाँच", "बस देख रहे हैं"],
  info: ["फ्रेम दिखाइए", "Sunglasses दिखाइए"],
  prefs: ["₹1,000 तक", "₹2,000 तक", "₹5,000 तक", "गोल फ्रेम", "Aviator", "बजट कोई भी"],
  show: ["अगला दिखाओ", "ये पसंद है", "गोल वाला दिखाओ", "बस, इतना ही"],
  end_of_list: ["शुरू से दोबारा दिखाओ", "बजट बढ़ाओ", "बस, इतना ही"],
  liked: ["हाँ, executive से मिलवाइए", "और दिखाओ", "बस, इतना ही"],
  lead: ["नंबर नहीं देना"],
  goodbye: ["और फ्रेम दिखाओ"],
};

const PLACEHOLDER: Partial<Record<ConversationStage, string>> = {
  prefs: "जैसे “गोल फ्रेम, ₹2000 तक”",
  lead: "आपका नाम और मोबाइल नंबर",
};

/**
 * Text mode's way to talk to the assistant: quick replies for the current
 * step plus a message box, at the bottom of the mirror. The small orb shows
 * the assistant's state (and ends the conversation when tapped). Typing
 * before a session exists starts one — no separate "start" step.
 */
export function TextComposer() {
  const phase = useVoiceStore((s) => s.phase);
  const status = useVoiceStore((s) => s.status);
  const stage = useVoiceStore((s) => s.stage);
  const ended = useVoiceStore((s) => s.ended);
  const send = useVoiceStore((s) => s.send);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const [draft, setDraft] = useState("");

  // Text mode has no audio to drive the orb: while a reply appears, give it
  // a soft speech-like level so it moves as it does when it talks.
  useEffect(() => {
    if (phase !== "speaking") return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      voiceLevels.bot = 0.35 + 0.35 * Math.max(0, Math.sin(t * 8) * Math.sin(t * 2.1));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      voiceLevels.bot = 0;
    };
  }, [phase]);

  const live = status === "connected" || status === "connecting";
  const busy = phase === "thinking" || status === "connecting";
  const replies = ended ? [] : QUICK_REPLIES[stage ?? "start"];
  const placeholder = (stage && PLACEHOLDER[stage]) || "यहाँ लिखिए…";

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    send(text);
    setDraft("");
  };

  return (
    // Full-width strip: it must not swallow clicks meant for the corners
    // (the talk/type switch sits bottom-left) — only its contents take them.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pb-3 sm:gap-3 sm:pb-5">
      {replies.length ? (
        <div className="pointer-events-auto flex max-w-3xl flex-wrap justify-center gap-1.5 sm:gap-2">
          {replies.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => submit(r)}
              disabled={busy}
              className="rounded-full bg-white/85 px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition hover:bg-white active:scale-[0.97] disabled:opacity-50 sm:px-4 sm:py-2 sm:text-base"
            >
              {r}
            </button>
          ))}
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-full bg-white/90 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.28)] ring-1 ring-black/5 backdrop-blur-md"
      >
        {/* The assistant's state: thinking = a pulsing ring and a slightly
            larger orb (replaces the old typing dots); replying = it moves. */}
        <span className="relative ml-0.5 shrink-0" aria-hidden>
          {phase === "thinking" ? (
            <span className="orb-ping pointer-events-none absolute -inset-1 rounded-full border-2 border-indigo-400/70" />
          ) : null}
          <VoiceOrb
            className={`block h-9 w-9 transition-transform duration-300 sm:h-10 sm:w-10 ${
              phase === "thinking" || phase === "speaking" ? "scale-110" : ""
            }`}
          />
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          enterKeyHint="send"
          autoComplete="off"
          aria-label="अपना संदेश लिखिए"
          className="min-w-0 flex-1 bg-transparent px-1 text-base text-zinc-900 outline-none placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={!draft.trim() || busy}
          className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-35"
        >
          भेजें
        </button>
        {live ? (
          <button
            type="button"
            onClick={disconnect}
            title="बातचीत ख़त्म करें · End"
            aria-label="बातचीत ख़त्म करें"
            className="mr-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </form>
    </div>
  );
}
