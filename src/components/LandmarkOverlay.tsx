"use client";

import { useEffect, useRef } from "react";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Draws MediaPipe landmarks as dots on a 2D canvas over the mirrored video.
 * PERF: full redraw each animation frame when enabled — keep toggled off by default.
 */
export function LandmarkOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showLandmarks = useTryOnStore((s) => s.showLandmarks);
  const landmarks = useTryOnStore((s) => s.landmarks);
  const hasFace = useTryOnStore((s) => s.hasFace);

  useEffect(() => {
    if (!showLandmarks) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    let raf = 0;
    const draw = () => {
      const { landmarks: lms, hasFace: face } = useTryOnStore.getState();
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      if (face && lms) {
        ctx.fillStyle = "rgba(0, 255, 180, 0.85)";
        for (const p of lms) {
          // Mirror X to match CSS-mirrored video.
          const x = (1 - p.x) * w;
          const y = p.y * h;
          ctx.beginPath();
          ctx.arc(x, y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [showLandmarks, landmarks, hasFace]);

  if (!showLandmarks) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      aria-hidden
    />
  );
}
