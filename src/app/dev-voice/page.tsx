"use client";

import { useEffect } from "react";
import { VoiceStageOverlay } from "@/components/voice/VoiceStageOverlay";
import { FrameWheel } from "@/components/FrameWheel";
import { useVoiceStore, voiceLevels, type ConversationStage, type VoicePhase } from "@/store/voiceStore";
import { useUiStore } from "@/store/uiStore";

/**
 * Dev preview of the voice overlay without camera or bot: buttons drive the
 * phases, a fake level oscillator stands in for the audio meters. ?mode=text
 * previews typing; there, send() echoes the line and fakes a short reply.
 */
const DEMO = [
  { sku: "EN-1001", name: "Classic Aviator", brand: "Vincent Chase", price: 1200, shape: "aviator", frameId: "aviator", variantId: "aviator-black" },
  { sku: "EN-1002", name: "Trendy Round", brand: "Lenskart", price: 800, shape: "round", frameId: "round", variantId: "round-tortoise" },
  { sku: "EN-1003", name: "Bold Square", brand: "John Jacobs", price: 2400, shape: "square", frameId: "round", variantId: "round-tortoise" },
];

export default function DevVoice() {
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const syl = Math.max(0, Math.sin(t * 9) * Math.sin(t * 2.3));
      const phase = useVoiceStore.getState().phase;
      voiceLevels.bot = phase === "speaking" ? syl : 0;
      voiceLevels.mic = phase === "user" ? syl * 0.8 : 0.02;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    let lineId = 100;
    useVoiceStore.setState({
      connect: () => useVoiceStore.setState({ phase: "listening", status: "connected" }),
      disconnect: () => useVoiceStore.setState({ phase: "off", status: "idle" }),
      send: (text: string) => {
        useVoiceStore.setState((s) => ({
          status: "connected",
          phase: "thinking",
          botCaption: "",
          transcript: [...s.transcript, { id: ++lineId, role: "user", text }],
        }));
        setTimeout(() => {
          const reply = "ठीक है जी, देखिए — यह रहा अगला फ्रेम। पसंद आया, या अगला दिखाऊँ?";
          useVoiceStore.setState((s) => ({
            phase: "speaking",
            botCaption: reply,
            transcript: [...s.transcript, { id: ++lineId, role: "bot", text: reply }],
          }));
          setTimeout(() => useVoiceStore.setState({ phase: "listening" }), 1200);
        }, 1400);
      },
    });
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "text" || mode === "voice") useUiStore.getState().setInputMode(mode);
    const p = params.get("phase") as VoicePhase | null;
    if (p) useVoiceStore.setState({ phase: p, status: p === "off" ? "idle" : "connected" });
    if (params.has("scene")) {
      useVoiceStore.setState((s) => ({
        status: "connected",
        phase: "speaking",
        suggestions: DEMO.map((d, i) => ({ kind: "try_on_frame" as const, ...d, index: i, total: DEMO.length })),
        activeSku: DEMO[0].sku,
        picks: [DEMO[1].sku],
        dropSeq: s.dropSeq + 1,
        likeSeq: s.likeSeq + 1,
        transcript: [
          { id: 1, role: "user", text: "मुझे हल्का रोज़ पहनने वाला चश्मा दिखाओ" },
          { id: 2, role: "bot", text: "यह रहा Vincent Chase का Classic Aviator" },
        ],
        botCaption: "यह रहा Vincent Chase का Classic Aviator, बारह सौ रुपये — पसंद आया?",
      }));
    }
    return () => cancelAnimationFrame(raf);
  }, []);

  const setPhase = (phase: VoicePhase) => useVoiceStore.setState({ phase });
  const say = (text: string) => {
    useVoiceStore.setState({ phase: "speaking", botCaption: "" });
    const words = text.split(" ");
    words.forEach((w, i) =>
      setTimeout(() => useVoiceStore.setState((s) => ({ botCaption: s.botCaption ? `${s.botCaption} ${w}` : w })), i * 260),
    );
  };
  const drop = (i: number) => {
    const d = { kind: "try_on_frame" as const, ...DEMO[i], index: i, total: DEMO.length };
    useVoiceStore.setState((s) => ({
      suggestions: s.suggestions.some((x) => x.sku === d.sku) ? s.suggestions : [...s.suggestions, d],
      activeSku: d.sku,
      dropSeq: s.dropSeq + 1,
    }));
  };

  const btn = "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50";
  const stages: ConversationStage[] = ["greet", "prefs", "show", "liked", "lead", "end_of_list"];

  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center gap-2">
        {(["off", "connecting", "listening", "user", "thinking", "speaking", "error"] as VoicePhase[]).map((p) => (
          <button key={p} onClick={() => setPhase(p)} className={btn}>
            {p}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-300" aria-hidden />
        <button
          onClick={() => useVoiceStore.setState({ phase: "user", userInterim: "मुझे गोल वाला चश्मा दिखाओ" })}
          className={btn}
        >
          user caption
        </button>
        <button
          onClick={() => say("यह रहा Vincent Chase का Classic Aviator, बारह सौ रुपये। स्क्रीन पर अपने चेहरे पर देखिए। पसंद आया, या अगला दिखाऊँ?")}
          className={btn}
        >
          bot says
        </button>
        {DEMO.map((d, i) => (
          <button key={d.sku} onClick={() => drop(i)} className={btn}>
            drop {d.shape}
          </button>
        ))}
        <button
          onClick={() =>
            useVoiceStore.setState((s) => ({ picks: s.activeSku ? [...s.picks, s.activeSku] : s.picks, likeSeq: s.likeSeq + 1 }))
          }
          className={btn}
        >
          like
        </button>
        <button
          onClick={() =>
            useVoiceStore.setState({
              phase: "error",
              status: "error",
              errorMessage: "Sarvam: insufficient credits (402)",
            })
          }
          className={btn}
        >
          error (credits)
        </button>
        <span className="mx-1 h-4 w-px bg-zinc-300" aria-hidden />
        <button onClick={() => useUiStore.getState().setInputMode("voice")} className={btn}>
          mode: voice
        </button>
        <button onClick={() => useUiStore.getState().setInputMode("text")} className={btn}>
          mode: text
        </button>
        {stages.map((st) => (
          <button key={st} onClick={() => useVoiceStore.setState({ stage: st, status: "connected" })} className={btn}>
            stage {st}
          </button>
        ))}
      </div>
      <div className="relative mx-auto aspect-[4/3] w-full max-w-4xl overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-500 to-zinc-700 ring-1 ring-zinc-200">
        <VoiceStageOverlay />
        <FrameWheel />
      </div>
    </main>
  );
}
