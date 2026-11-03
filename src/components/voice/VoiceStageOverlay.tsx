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
  off: "बात करने के लिए टैप करें",
  connecting: "जोड़ रहा हूँ…",
  listening: "सुन रहा हूँ…",
  user: "सुन रहा हूँ…",
  thinking: "सोच रहा हूँ…",
  speaking: "",
  error: "दोबारा टैप करें",
};

/** The orb as the call button, bottom-right of the mirror. */
function OrbButton() {
  const phase = useVoiceStore((s) => s.phase);
  const status = useVoiceStore((s) => s.status);
  const connect = useVoiceStore((s) => s.connect);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const live = status === "connected" || status === "connecting";
  const label = PHASE_LABEL[phase];
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-50 flex flex-col items-center sm:bottom-4 sm:right-4">
      <button
        type="button"
        onClick={() => (live ? disconnect() : connect())}
        className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
        aria-label={live ? "End conversation" : "Talk to the assistant"}
        title={live ? "End conversation" : "Talk to the assistant"}
      >
        <VoiceOrb size={112} className="transition-transform duration-300 group-hover:scale-105 group-active:scale-95" />
        {phase === "off" ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-white/90 drop-shadow" fill="currentColor" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
            </svg>
          </span>
        ) : null}
      </button>
      {label ? (
        <span className="-mt-2 rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * When the assistant shows a frame: a card flies out of the orb to the top
 * of the mirror (name, brand, price, n of N), the face area flashes, then
 * the card stays a few seconds.
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
    // From the orb (bottom-right) to the card (top-centre).
    if (box) setOffset({ x: box.width / 2 - 72, y: box.height - 150 });
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
        style={{ boxShadow: "0 0 80px 30px rgba(255,214,140,0.45), inset 0 0 60px 20px rgba(255,214,140,0.35)" }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center sm:top-4">
        <div
          key={`card-${shown.seq}`}
          className="frame-drop flex items-center gap-3 rounded-2xl border border-white/15 bg-black/55 py-2 pl-3 pr-4 text-white shadow-2xl backdrop-blur-md"
          style={{ "--drop-x": `${offset.x}px`, "--drop-y": `${offset.y}px` } as React.CSSProperties}
        >
          <FrameGlyph shape={s.shape} color="#fcd9a0" className="h-8 w-16" />
          <div className="leading-tight">
            <p className="text-sm font-semibold sm:text-base">
              {s.name}
              {s.price != null ? <span className="ml-2 text-amber-200">{formatRupees(s.price)}</span> : null}
            </p>
            <p className="text-[11px] text-white/60">
              {s.brand}
              {s.total ? ` · ${(s.index ?? 0) + 1} / ${s.total}` : ""}
              {rendered ? ` · 3D: ${rendered}` : ""}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/** Hearts floating up from the frame card on "ye pasand hai". */
function HeartBurst() {
  const likeSeq = useVoiceStore((s) => s.likeSeq);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    if (!likeSeq) return;
    setSeq(likeSeq);
    const id = setTimeout(() => setSeq(0), 1600);
    return () => clearTimeout(id);
  }, [likeSeq]);
  if (!seq) return null;
  const hearts = [-70, -35, 0, 35, 70, -50, 50];
  return (
    <div key={seq} className="pointer-events-none absolute left-1/2 top-[45%] z-40">
      {hearts.map((hx, i) => (
        <span
          key={i}
          className="heart-pop absolute text-3xl"
          style={{
            "--hx": `${hx}px`,
            "--hr": `${hx / 3}deg`,
            animationDelay: `${i * 70}ms`,
            left: `${hx / 4}px`,
          } as React.CSSProperties}
        >
          ❤️
        </span>
      ))}
    </div>
  );
}

/**
 * Shortlist filmstrip along the bottom of the mirror: every frame the
 * assistant showed, current one lit, liked ones hearted. Tap to put it back
 * on the face.
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
    <div className="pointer-events-auto absolute bottom-3 left-3 right-36 z-40 sm:bottom-4 sm:left-4">
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              className={`relative flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left backdrop-blur-md transition ${
                active
                  ? "border-amber-200/70 bg-black/60 text-white shadow-[0_0_24px_rgba(252,217,160,0.35)]"
                  : "border-white/10 bg-black/35 text-white/75 hover:bg-black/50"
              }`}
            >
              <FrameGlyph shape={s.shape} color={active ? "#fcd9a0" : "#e4e4e7"} className="h-6 w-12" />
              <span className="leading-tight">
                <span className="block max-w-[9rem] truncate text-xs font-medium">{s.name}</span>
                <span className="block text-[10px] text-white/55">{formatRupees(s.price) || s.brand}</span>
              </span>
              {liked ? <span className="absolute -right-1 -top-1.5 text-sm">❤️</span> : null}
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

/**
 * Walk-up screen while the assistant is off: a greeting that invites the
 * customer to tap the orb, with sample frame shapes drifting. Gone the
 * moment a conversation starts.
 */
function IdleAttract() {
  const phase = useVoiceStore((s) => s.phase);
  const suggestions = useVoiceStore((s) => s.suggestions.length);
  if (phase !== "off" || suggestions > 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-center pt-6 text-center sm:pt-10">
      <div className="flex gap-6 opacity-70">
        {["aviator", "round", "cat-eye"].map((shape, i) => (
          <span key={shape} className="idle-float" style={{ animationDelay: `${i * 0.8}s` }}>
            <FrameGlyph shape={shape} color="#fcd9a0" className="h-6 w-12 sm:h-8 sm:w-16" />
          </span>
        ))}
      </div>
      <p className="mt-3 rounded-2xl bg-black/35 px-5 py-2 text-xl font-semibold text-white shadow-lg backdrop-blur-md sm:text-3xl">
        नमस्ते! 👋
      </p>
      <p className="mt-2 rounded-full bg-black/35 px-4 py-1 text-sm text-white/85 backdrop-blur-md sm:text-base">
        नीचे वाला गोला दबाइए और बोलिए — मैं आपके लिए फ्रेम पहनाकर दिखाऊँगा
      </p>
    </div>
  );
}

/** Everything the voice assistant draws on top of the mirror. */
export function VoiceStageOverlay() {
  const boxRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 z-40">
      {/* Soft vignette at the bottom so captions and the strip stay legible. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/45 to-transparent" />
      <IdleAttract />
      <FrameDrop boxRef={boxRef} />
      <HeartBurst />
      <VoiceCaptions />
      <ShortlistStrip />
      <OrbButton />
    </div>
  );
}
