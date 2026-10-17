"use client";

import { useEffect, useRef, type RefObject } from "react";
import { setFrameSyncCanvas } from "@/tracking/frameSync";

interface WebcamFeedProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
}

/**
 * Mirrored webcam preview. Uses object-fill with a stage that matches the
 * video aspect ratio so landmark UVs map 1:1 — object-cover crops and breaks fit.
 */
export function WebcamFeed({ videoRef, className = "" }: WebcamFeedProps) {
  // Frame-synchronous display: the visible picture is a canvas that the
  // tracker paints with the exact frame it analysed (tracking/frameSync.ts).
  // The <video> keeps playing underneath as the source; the canvas covers it
  // once painted, and an unpainted (transparent) canvas falls back to it.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setFrameSyncCanvas(canvasRef.current);
    return () => setFrameSyncCanvas(null);
  }, []);
  return (
    // The caller positions this box (TryOnStage passes "absolute inset-0").
    // Do not add "relative" here: Tailwind orders relative after absolute, so
    // it overrode the caller and collapsed the box to zero height (black stage).
    <div className={className || "relative h-full w-full"}>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-fill [-webkit-transform:scaleX(-1)] [transform:scaleX(-1)]"
        playsInline
        muted
        autoPlay
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full object-fill [-webkit-transform:scaleX(-1)] [transform:scaleX(-1)]"
        aria-label="Live camera preview"
      />
    </div>
  );
}
