"use client";

import { useEffect, type RefObject } from "react";
import {
  emaLight,
  frameStats,
  mapLightEstimate,
} from "@/lib/lightEstimate";
import { useTryOnStore } from "@/store/tryOnStore";

const SAMPLE_W = 16;
const SAMPLE_H = 12;
const INTERVAL_MS = 500;

/** Samples the webcam frame every 500 ms and EMA-updates store.lightEstimate. */
export function useLightEstimate(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      try {
        ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
        const stats = frameStats(
          ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data,
        );
        if (!stats) return;
        const store = useTryOnStore.getState();
        store.setLightEstimate(
          emaLight(
            store.lightEstimate,
            mapLightEstimate(stats.meanRgb, stats.p90Luma),
          ),
        );
      } catch {
        // Canvas tainted / video gone — skip this sample.
      }
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [videoRef, enabled]);
}
