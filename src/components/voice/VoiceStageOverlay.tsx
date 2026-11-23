"use client";

import { useEffect, useRef, useState } from "react";
import { getFrameById } from "@/data/frames";
import { useTryOnStore } from "@/store/tryOnStore";
import { useVoiceStore, type TryOnSuggestion, type VoicePhase } from "@/store/voiceStore";
import { FrameGlyph } from "./FrameGlyph";
import { VoiceCaptions } from "./VoiceCaptions";
import { VoiceOrb } from "./VoiceOrb";

export const formatRupees = (n?: number) =>
  n == null ? "" : `₹${n.toLocaleString("en-IN")}`;

const PHASE_LABEL: Record<VoicePhase, string> = {
  off: "Tap to speak",
  connecting: "Connecting…",
  listening: "Listening…",
  user: "Listening…",
  thinking: "One moment…",
  speaking: "",
  error: "Tap to try again",
};

/** The assistant. Idle: a larger sphere at lower-centre waiting for a tap.
 *  Connected: it settles onto a bottom-centre spot, captions just above. */
function VoicePresence({ attract }: { attract: boolean }) {
  const phase = useVoiceStore((s) => s.phase);
  const status = useVoiceStore((s) => s.status);
  const connect = useVoiceStore((s) => s.connect);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const live = status === "connected" || status === "connecting";
  const label = PHASE_LABEL[phase];
  return (
    <div
      className="pointer-events-auto absolute left-1/2 z-50 flex -translate-x-1/2 flex-col items-center transition-[bottom] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ bottom: attract ? "30%" : "1rem" }}
    >
      <div
        className={`relative origin-bottom transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          attract ? "scale-105 sm:scale-125" : "scale-[0.55] sm:scale-[0.7]"
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
        <span className="mt-1 whitespace-nowrap rounded-full bg-white/75 px-3 py-1 text-[11px] font-medium text-zinc-700 shadow-sm backdrop-blur">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * When the assistant shows a frame: a card flies out of the orb to the top
 * of the mirror (name, brand, price, n of N), the face area flashes, then
 * the card stays a few seconds — a hairline under it counts down.
 */
function FrameDrop({ boxRef }: { boxRef: React.RefObject<HTMLDivElement | null> }) {
  const dropSeq = useVoiceStore((s) => s.dropSeq);
  const activeSku = useVoiceStore((s) => s.activeSku);
  const suggestion = useVoiceStore((s) => s.suggestions.find((x) => x.sku === s.activeSku));
  const [shown, setShown] = useState<{ seq: number; s: TryOnSuggestion } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!dropSeq || !suggestion) return;
    const box = boxRef.current?.getBoundingClientRect();
    // From the orb (bottom-centre) to the card (top-centre).
    if (box) setOffset({ x: 0, y: box.height * 0.55 });
    setShown({ seq: dropSeq, s: suggestion });
    const id = setTimeout(() => setShown(null), 8000);
    return () => clearTimeout(id);
    // Only a new drop (dropSeq) restarts the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropSeq, activeSku]);

  if (!shown) return null;
  const s = shown.s;
  let rendered = "";
  try {
    const f = getFrameById(s.frameId);
    rendered = f.name;
  } catch {
    rendered = "";
  }
  return (
    <>
      <div
        key={`flash-${shown.seq}`}
        className="face-flash pointer-events-none absolute left-1/2 top-[38%] z-30 h-[55%] w-[45%] -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
        style={{ boxShadow: "0 0 70px 26px rgba(255,255,255,0.45), inset 0 0 50px 18px rgba(255,255,255,0.30)" }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center sm:top-4">
        <div
          key={`card-${shown.seq}`}
          className="frame-drop relative flex items-center gap-3 overflow-hidden rounded-xl border border-black/5 bg-white/85 py-2 pl-3 pr-4 text-zinc-900 shadow-[0_12px_36px_rgba(0,0,0,0.25)] backdrop-blur-md"
          style={{ "--drop-x": `${offset.x}px`, "--drop-y": `${offset.y}px` } as React.CSSProperties}
        >
          <FrameGlyph shape={s.shape} color="#3f3f46" className="h-8 w-16" />
          <div className="leading-tight">
            <p className="text-sm font-semibold sm:text-base">
              {s.name}
              {s.price != null ? <span className="ml-2 font-normal text-zinc-500">{formatRupees(s.price)}</span> : null}
            </p>
            <p className="text-[11px] text-zinc-500">
              {s.brand}
              {s.total ? ` · ${(s.index ?? 0) + 1} / ${s.total}` : ""}
              {rendered ? ` · 3D: ${rendered}` : ""}
            </p>
          </div>
          <span className="drop-progress absolute -bottom-px left-4 right-4 h-px bg-indigo-400/70" aria-hidden />
        </div>
      </div>
    </>
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

/**
 * Shortlist filmstrip along the bottom-left of the mirror: every frame the
 * assistant showed, current one highlighted. Tap to put it back on the face.
 * Ends before the orb's spot.
 */
function ShortlistStrip() {
  const suggestions = useVoiceStore((s) => s.suggestions);
  const activeSku = useVoiceStore((s) => s.activeSku);
  const picks = useVoiceStore((s) => s.picks);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>("[data-active='true']");
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeSku]);

  if (suggestions.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 right-[calc(50%+64px)] z-40 sm:bottom-5 sm:left-5 sm:right-[calc(50%+88px)]">
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_88%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {suggestions.map((s) => {
          const active = s.sku === activeSku;
          const liked = picks.includes(s.sku);
          return (
            <button
              key={s.sku}
              type="button"
              data-active={active}
              onClick={() => showSuggestionOnFace(s)}
              className={`relative flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left shadow-sm backdrop-blur-md transition ${
                active
                  ? "border-indigo-500/70 bg-white/90 text-zinc-900"
                  : "border-black/5 bg-white/60 text-zinc-600 hover:bg-white/85"
              }`}
            >
              <FrameGlyph shape={s.shape} color={active ? "#4f46e5" : "#71717a"} className="h-6 w-12" />
              <span className="leading-tight">
                <span className="block max-w-[9rem] truncate text-xs font-medium">{s.name}</span>
                <span className="block text-[10px] text-zinc-400">{formatRupees(s.price) || s.brand}</span>
              </span>
              {liked ? (
                <svg
                  viewBox="0 0 24 24"
                  className="absolute -right-1.5 -top-1.5 h-4 w-4 text-rose-400 drop-shadow"
                  fill="currentColor"
                  aria-label="Liked"
                >
                  <path d="M12 21s-7.5-4.9-9.8-9.2C.6 8.6 2.4 5.4 5.6 5.4c1.9 0 3.4 1 4.3 2.5L12 10.6l2.1-2.7c.9-1.5 2.4-2.5 4.3-2.5 3.2 0 5 3.2 3.4 6.4C19.5 16.1 12 21 12 21Z" />
                </svg>
              ) : null}
            </button>
          );
        })}
      </div>
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

/** Walk-up greeting while the assistant rests — two lines, that's all. */
function IdleAttract({ attract }: { attract: boolean }) {
  if (!attract) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-center pt-10 text-center sm:pt-14">
      <h2 className="text-3xl font-semibold tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] sm:text-5xl">
        नमस्ते
      </h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/80 drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)] sm:max-w-sm">
        हिंदी, Hinglish या English में बोलिए — फ्रेम सीधे आपके चेहरे पर दिखेंगे।
      </p>
    </div>
  );
}

/** Everything the voice assistant draws on top of the mirror. */
export function VoiceStageOverlay() {
  const boxRef = useRef<HTMLDivElement>(null);
  const phase = useVoiceStore((s) => s.phase);
  const hasHistory = useVoiceStore((s) => s.suggestions.length > 0);
  const attract = phase === "off" && !hasHistory;
  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-40">
      {/* Soft vignette so captions, strip and the orb stay legible. */}
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/40 to-transparent" />
      <IdleAttract attract={attract} />
      <FrameDrop boxRef={boxRef} />
      <LikeBurst />
      <VoiceCaptions />
      <ShortlistStrip />
      <VoicePresence attract={attract} />
    </div>
  );
}
