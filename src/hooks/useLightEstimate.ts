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
/** GPU-side shrink before the CPU read: only this many pixels leave the GPU. */
const SHRINK_W = 64;
const SHRINK_H = 48;
/** Room light changes slowly, and the estimate is EMA-smoothed anyway. */
const INTERVAL_MS = 1000;

/**
 * Samples the webcam frame once a second and EMA-updates store.lightEstimate.
 *
 * The frame is first shrunk on the GPU (a 64×48 accelerated canvas), then
 * that tiny image is read on the CPU. Drawing the 1280×720 video straight
 * into a CPU canvas meant reading the whole frame back from the GPU (~65 ms
 * on the kiosk) twice a second, stalling the tracker and renderer.
 */
export function useLightEstimate(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const shrink = document.createElement("canvas");
    shrink.width = SHRINK_W;
    shrink.height = SHRINK_H;
    // GPU-backed: never read directly (getImageData would demote it).
    const shrinkCtx = shrink.getContext("2d", { alpha: false });
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !shrinkCtx) return;

    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      try {
        shrinkCtx.drawImage(video, 0, 0, SHRINK_W, SHRINK_H);
        ctx.drawImage(shrink, 0, 0, SAMPLE_W, SAMPLE_H);
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
