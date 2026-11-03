"use client";

import { useEffect } from "react";
import { VoiceStageOverlay } from "@/components/voice/VoiceStageOverlay";
import { useVoiceStore, voiceLevels, type VoicePhase } from "@/store/voiceStore";

/**
 * Dev preview of the voice overlay without camera or bot: buttons drive the
 * phases, a fake level oscillator stands in for the audio meters.
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
    useVoiceStore.setState({
      connect: () => useVoiceStore.setState({ phase: "listening", status: "connected" }),
      disconnect: () => useVoiceStore.setState({ phase: "off", status: "idle" }),
    });
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

  return (
    <main className="min-h-screen bg-zinc-900 p-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {(["off", "connecting", "listening", "user", "thinking", "speaking", "error"] as VoicePhase[]).map((p) => (
          <button key={p} onClick={() => setPhase(p)} className="rounded bg-white/10 px-3 py-1 text-sm text-white">
            {p}
          </button>
        ))}
        <button
          onClick={() => useVoiceStore.setState({ phase: "user", userInterim: "मुझे गोल वाला चश्मा दिखाओ" })}
          className="rounded bg-teal-600 px-3 py-1 text-sm text-white"
        >
          user caption
        </button>
        <button
          onClick={() => say("यह रहा Vincent Chase का Classic Aviator, बारह सौ रुपये। स्क्रीन पर अपने चेहरे पर देखिए। पसंद आया, या अगला दिखाऊँ?")}
          className="rounded bg-amber-600 px-3 py-1 text-sm text-white"
        >
          bot says
        </button>
        {DEMO.map((d, i) => (
          <button key={d.sku} onClick={() => drop(i)} className="rounded bg-violet-600 px-3 py-1 text-sm text-white">
            drop {d.shape}
          </button>
        ))}
        <button
          onClick={() =>
            useVoiceStore.setState((s) => ({ picks: s.activeSku ? [...s.picks, s.activeSku] : s.picks, likeSeq: s.likeSeq + 1 }))
          }
          className="rounded bg-pink-600 px-3 py-1 text-sm text-white"
        >
          like
        </button>
      </div>
      <div className="relative mx-auto aspect-[4/3] w-full max-w-4xl overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-700 to-zinc-800">
        <VoiceStageOverlay />
      </div>
    </main>
  );
}
