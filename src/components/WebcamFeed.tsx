"use client";

import { useEffect, useRef, type RefObject } from "react";
import { setFrameSyncCanvas, setLiveVideo } from "@/tracking/frameSync";

interface WebcamFeedProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
}

/**
 * Mirrored webcam preview. Uses object-fill with a stage that matches the
 * video aspect ratio so landmark UVs map 1:1 — object-cover crops and breaks fit.
 */
export function WebcamFeed({ videoRef, className = "" }: WebcamFeedProps) {
  // The 3D renderer normally draws this <video> as its background (LIVE).
  // In frame-synchronous mode (staff option) the visible picture is instead
  // a canvas the tracker paints with the exact frame it analysed
  // (tracking/frameSync.ts); an unpainted (transparent) canvas falls back to
  // the video. The <video> stays visible underneath either way, so its
  // requestVideoFrameCallback (which drives the tracker) keeps firing.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setFrameSyncCanvas(canvasRef.current);
    setLiveVideo(videoRef.current);
    return () => {
      setFrameSyncCanvas(null);
      setLiveVideo(null);
    };
  }, [videoRef]);
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
