"use client";

import { useEffect, useRef, useState } from "react";
import { getFrameById } from "@/data/frames";
import { useTryOnStore } from "@/store/tryOnStore";
import { useVoiceStore, type TryOnSuggestion, type VoicePhase } from "@/store/voiceStore";
import { useUiStore } from "@/store/uiStore";
import { TextComposer } from "./TextComposer";
import { VoiceCaptions } from "./VoiceCaptions";
import { VoiceOrb } from "./VoiceOrb";

export const formatRupees = (n?: number) =>
  n == null ? "" : `₹${n.toLocaleString("en-IN")}`;

const PHASE_LABEL: Record<VoicePhase, string> = {
  off: "बोलने के लिए छुएँ",
  connecting: "जुड़ रहे हैं…",
  listening: "सुन रहे हैं…",
  user: "सुन रहे हैं…",
  thinking: "एक पल…",
  speaking: "",
  error: "फिर से छुएँ",
};

/** Customer-facing reason for a failed session (the raw error is for staff). */
export function friendlyError(message: string | null): string {
  const m = (message ?? "").toLowerCase();
  if (/notallowed|permission|denied/.test(m)) return "माइक की अनुमति नहीं मिली";
  if (/quota|credit|402|429|insufficient|payment|exhausted|rate/.test(m)) return "सहायक अभी व्यस्त है";
  if (/fetch|network|reach|offer|ice|timeout|timed out|connect/.test(m)) return "सहायक से जुड़ नहीं पाए";
  return "कुछ गड़बड़ हो गई";
}

/** Hindi shape names (catalogue shapes). */
export const SHAPE_LABEL: Record<string, string> = {
  round: "गोल",
  square: "चौकोर",
  rectangular: "आयताकार",
  aviator: "Aviator",
  "cat-eye": "Cat-eye",
  oval: "अंडाकार",
};

/** The assistant: a sphere at bottom-centre with its status label under it,
 *  slightly larger while idle (inviting a tap); captions sit just above. */
function VoicePresence({ attract }: { attract: boolean }) {
  const phase = useVoiceStore((s) => s.phase);
  const status = useVoiceStore((s) => s.status);
  const connect = useVoiceStore((s) => s.connect);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const errorMessage = useVoiceStore((s) => s.errorMessage);
  const setInputMode = useUiStore((s) => s.setInputMode);
  const live = status === "connected" || status === "connecting";
  const failed = phase === "error";
  const label = failed ? `${friendlyError(errorMessage)} · ${PHASE_LABEL.error}` : PHASE_LABEL[phase];
  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center sm:bottom-4"
    >
      <div
        className={`relative origin-bottom transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          attract ? "scale-[0.65] sm:scale-[0.8]" : "scale-[0.55] sm:scale-[0.7]"
        }`}
      >
        {attract ? (
          <span className="orb-ping pointer-events-none absolute -inset-[10%] rounded-full border border-white/50" aria-hidden />
        ) : null}
        <button
          type="button"
          onClick={() => (live ? disconnect() : connect())}
          className="group relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          aria-label={live ? "End conversation" : "Talk to the assistant"}
          title={live ? "End conversation" : "Talk to the assistant"}
        >
          {/* Perf: the shader canvas animates at 60 fps inside one small
              square — the only per-frame UI work in the overlay. */}
          <VoiceOrb className="block h-40 w-40 transition-transform duration-300 group-hover:scale-[1.03] group-active:scale-[0.97] sm:h-44 sm:w-44" />
          {phase === "off" ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-white/90 drop-shadow" fill="currentColor" aria-hidden>
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
              </svg>
            </span>
          ) : null}
        </button>
      </div>
      {label ? (
        <span
          className={`mt-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium shadow-sm backdrop-blur ${
            failed ? "bg-rose-50/90 text-rose-700" : "bg-white/75 text-zinc-700"
          }`}
        >
          {label}
        </span>
      ) : null}
      {failed ? (
        <button
          type="button"
          onClick={() => setInputMode("text")}
          className="mt-2 rounded-full bg-white/90 px-4 py-1.5 text-sm font-medium text-zinc-900 shadow-sm backdrop-blur transition hover:bg-white"
        >
          लिखकर पूछें · Type instead
        </button>
      ) : null}
    </div>
  );
}

/**
 * Talk or type — always available. Switching during a conversation ends the
 * session and starts one in the new mode (the shortlist and transcript stay).
 */
function InputModeToggle() {
  const inputMode = useUiStore((s) => s.inputMode);
  const setInputMode = useUiStore((s) => s.setInputMode);
  const switchTo = (mode: "voice" | "text") => {
    if (mode === useUiStore.getState().inputMode) return;
    const { status, disconnect, connect } = useVoiceStore.getState();
    const live = status === "connected" || status === "connecting";
    if (live) disconnect();
    setInputMode(mode);
    if (live) connect();
  };
  const opt = (mode: "voice" | "text", label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => switchTo(mode)}
      aria-pressed={inputMode === mode}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
        inputMode === mode ? "bg-white text-zinc-900 shadow-sm" : "text-white/85 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-50 flex rounded-full bg-black/35 p-1 backdrop-blur-md sm:bottom-4 sm:left-4">
      {opt(
        "voice",
        "बोलें",
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
        </svg>,
      )}
      {opt(
        "text",
        "लिखें",
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" strokeLinecap="round" />
        </svg>,
      )}
    </div>
  );
}

/** Text mode: why the last session failed, above the message box. */
function TextModeError() {
  const phase = useVoiceStore((s) => s.phase);
  const errorMessage = useVoiceStore((s) => s.errorMessage);
  if (phase !== "error" && !errorMessage) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[7.5rem] z-50 flex justify-center px-3 sm:bottom-[8.5rem]">
      <span
        className="rounded-full bg-rose-50/95 px-3 py-1 text-xs font-medium text-rose-700 shadow-sm"
        title={errorMessage ?? ""}
      >
        {friendlyError(errorMessage)} — फिर से लिखकर भेजें
      </span>
    </div>
  );
}

/**
 * When the assistant shows a frame: a brief flash around the face. The
 * frame's details are on the dial (its current frame), not in a card.
 */
function FrameDrop() {
  const dropSeq = useVoiceStore((s) => s.dropSeq);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    if (!dropSeq) return;
    setSeq(dropSeq);
    const id = setTimeout(() => setSeq(0), 900);
    return () => clearTimeout(id);
  }, [dropSeq]);
  if (!seq) return null;
  return (
    <div
      key={`flash-${seq}`}
      className="face-flash pointer-events-none absolute left-1/2 top-[38%] z-30 h-[55%] w-[45%] -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
      style={{ boxShadow: "0 0 70px 26px rgba(255,255,255,0.45), inset 0 0 50px 18px rgba(255,255,255,0.30)" }}
    />
  );
}

/** One heart drifting up on "ye pasand hai". */
function LikeBurst() {
  const likeSeq = useVoiceStore((s) => s.likeSeq);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    if (!likeSeq) return;
    setSeq(likeSeq);
    const id = setTimeout(() => setSeq(0), 1500);
    return () => clearTimeout(id);
  }, [likeSeq]);
  if (!seq) return null;
  return (
    <div key={seq} className="pointer-events-none absolute left-1/2 top-[45%] z-40">
      <svg
        viewBox="0 0 24 24"
        className="like-float h-7 w-7 text-rose-400 drop-shadow"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 21s-7.5-4.9-9.8-9.2C.6 8.6 2.4 5.4 5.6 5.4c1.9 0 3.4 1 4.3 2.5L12 10.6l2.1-2.7c.9-1.5 2.4-2.5 4.3-2.5 3.2 0 5 3.2 3.4 6.4C19.5 16.1 12 21 12 21Z" />
      </svg>
    </div>
  );
}

/** Put a suggestion on the live face (agent push or a tap on the strip). */
export function showSuggestionOnFace(s: TryOnSuggestion) {
  const store = useTryOnStore.getState();
  let frame;
  try {
    frame = getFrameById(s.frameId);
  } catch {
    console.warn(`[EyeNetra:voice] try_on_frame → unknown frame id ${s.frameId}`);
    return;
  }
  // setFrame before setVariant — setFrame resets the variant to default.
  store.setFrame(frame.id);
  if (frame.variants.some((v) => v.id === s.variantId)) store.setVariant(s.variantId);
  useVoiceStore.setState({ activeSku: s.sku });
}

/** Everything the voice assistant draws on top of the mirror. */
export function VoiceStageOverlay() {
  const boxRef = useRef<HTMLDivElement>(null);
  const phase = useVoiceStore((s) => s.phase);
  const hasHistory = useVoiceStore((s) => s.suggestions.length > 0);
  const textMode = useUiStore((s) => s.inputMode === "text");
  const attract = phase === "off" && !hasHistory;
  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-40 select-none">
      {/* Soft vignette so captions, strip and the controls stay legible. */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent ${textMode ? "h-64" : "h-44"}`}
      />
      <FrameDrop />
      <LikeBurst />
      <VoiceCaptions />
      <InputModeToggle />
      {textMode ? (
        <>
          <TextModeError />
          <TextComposer />
        </>
      ) : (
        <VoicePresence attract={attract} />
      )}
    </div>
  );
}
