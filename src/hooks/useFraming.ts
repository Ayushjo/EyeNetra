"use client";

import { useEffect, useRef, useState } from "react";
import { LM } from "@/lib/mediapipe/constants";
import { useTryOnStore } from "@/store/tryOnStore";

export type FramingState =
  | "no-face"
  | "too-far"
  | "too-close"
  | "off-center"
  | "unsteady"
  | "good";

export type Framing = {
  state: FramingState;
  message: string;
  ok: boolean;
  /** 0..1 how well framed (for a subtle meter). */
  quality: number;
};

// Face width as a fraction of frame width (outer canthus 33 ↔ 263).
// Tuned for a typical laptop webcam at arm's length.
const FACE_W_MIN = 0.16; // below → come closer
const FACE_W_MAX = 0.42; // above → step back
const FACE_W_IDEAL = 0.29;
const CENTER_X = [0.3, 0.7] as const;
const CENTER_Y = [0.26, 0.64] as const;
const STEADY_EPS = 0.006; // normalized mid-eye motion per sample

const MESSAGES: Record<FramingState, string> = {
  "no-face": "Bring your face into view",
  "too-far": "Come a little closer",
  "too-close": "Move back a little",
  "off-center": "Center your face in the frame",
  unsteady: "Hold still…",
  good: "Perfect — hold still",
};

/**
 * Live framing coach (Face-ID style) for calibration. Polls the tracking store
 * on rAF and reports whether the user is well-positioned to scan. Cheap: a few
 * subtractions per frame, no allocation.
 */
export function useFraming(active: boolean): Framing {
  const [framing, setFraming] = useState<Framing>({
    state: "no-face",
    message: MESSAGES["no-face"],
    ok: false,
    quality: 0,
  });
  const raf = useRef<number | null>(null);
  const prevMid = useRef<{ x: number; y: number } | null>(null);
  const lastSet = useRef(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const { landmarks, hasFace } = useTryOnStore.getState();
      let next: Framing;

      if (!hasFace || !landmarks || landmarks.length < 468) {
        prevMid.current = null;
        next = { state: "no-face", message: MESSAGES["no-face"], ok: false, quality: 0 };
      } else {
        const l = landmarks[LM.LEFT_EYE_OUTER];
        const r = landmarks[LM.RIGHT_EYE_OUTER];
        const mid = landmarks[LM.MID_EYES] ?? landmarks[LM.NOSE_BRIDGE];
        const faceW = l && r ? Math.abs(l.x - r.x) : 0;
        const cx = mid?.x ?? 0.5;
        const cy = mid?.y ?? 0.5;

        let motion = 0;
        if (prevMid.current) {
          motion = Math.hypot(cx - prevMid.current.x, cy - prevMid.current.y);
        }
        prevMid.current = { x: cx, y: cy };

        let state: FramingState;
        if (faceW < FACE_W_MIN) state = "too-far";
        else if (faceW > FACE_W_MAX) state = "too-close";
        else if (
          cx < CENTER_X[0] ||
          cx > CENTER_X[1] ||
          cy < CENTER_Y[0] ||
          cy > CENTER_Y[1]
        )
          state = "off-center";
        else if (motion > STEADY_EPS) state = "unsteady";
        else state = "good";

        // Quality: how close face width is to ideal, penalized off-center.
        const distQ = 1 - Math.min(1, Math.abs(faceW - FACE_W_IDEAL) / 0.16);
        const centerQ =
          1 -
          Math.min(1, (Math.abs(cx - 0.5) / 0.25 + Math.abs(cy - 0.45) / 0.25) / 2);
        const quality = Math.max(0, Math.min(1, 0.6 * distQ + 0.4 * centerQ));

        next = {
          state,
          message: MESSAGES[state],
          ok: state === "good",
          quality,
        };
      }

      // Throttle React updates to ~10/s to avoid churn.
      const now = performance.now();
      if (now - lastSet.current > 100) {
        lastSet.current = now;
        setFraming((prev) =>
          prev.state === next.state &&
          Math.abs(prev.quality - next.quality) < 0.05
            ? prev
            : next,
        );
      }
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (raf.current != null) cancelAnimationFrame(raf.current);
      prevMid.current = null;
    };
  }, [active]);

  return framing;
}
