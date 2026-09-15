"use client";

import type { RefObject } from "react";

interface WebcamFeedProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
}

/**
 * Mirrored webcam preview. Uses object-fill with a stage that matches the
 * video aspect ratio so landmark UVs map 1:1 — object-cover crops and breaks fit.
 */
export function WebcamFeed({ videoRef, className = "" }: WebcamFeedProps) {
  return (
    <video
      ref={videoRef}
      className={`h-full w-full object-fill [-webkit-transform:scaleX(-1)] [transform:scaleX(-1)] ${className}`}
      playsInline
      muted
      autoPlay
      aria-label="Live camera preview"
    />
  );
}
