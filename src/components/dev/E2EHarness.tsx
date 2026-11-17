"use client";

import { useEffect } from "react";
import { useTryOnStore } from "@/store/tryOnStore";
import { useVoiceStore } from "@/store/voiceStore";

/**
 * Dev-only: with ?e2e=1 (development builds only) install the fake camera +
 * microphone (src/lib/e2eFakeMedia.ts) and expose the stores and a frame
 * timing log as window.__e2e for an automated test driver.
 */
export function E2EHarness() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!new URLSearchParams(window.location.search).has("e2e")) return;
    void import("@/lib/e2eFakeMedia").then((m) => m.installE2EFakeMedia());
    const log: { t: number; ev: string; detail?: string }[] = [];
    const unsubs = [
      useVoiceStore.subscribe((s, p) => {
        if (s.dropSeq > p.dropSeq) log.push({ t: performance.now(), ev: "voice:try_on_frame", detail: s.activeSku ?? "" });
        if (s.phase !== p.phase) log.push({ t: performance.now(), ev: `phase:${s.phase}` });
      }),
      useTryOnStore.subscribe((s, p) => {
        if (s.selectedFrameId !== p.selectedFrameId)
          log.push({ t: performance.now(), ev: "tryon:selected", detail: s.selectedFrameId });
      }),
    ];
    // GlassesModel reports "[EyeNetra:pivot] confirmed for <glb>" once a
    // model is loaded, placed and mounted — the moment it can be seen.
    const info = console.info.bind(console);
    console.info = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("[EyeNetra:pivot] confirmed for"))
        log.push({ t: performance.now(), ev: "glasses:mounted", detail: args[0].slice(31) });
      info(...args);
    };
    (window as unknown as Record<string, unknown>).__e2e = { tryOn: useTryOnStore, voice: useVoiceStore, log };
    return () => {
      unsubs.forEach((u) => u());
      console.info = info;
    };
  }, []);
  return null;
}
