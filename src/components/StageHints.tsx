"use client";

import { useEffect, useRef, useState } from "react";
import { DevFpsReadout } from "@/components/DevFpsReadout";
import { useFraming, type FramingState } from "@/hooks/useFraming";
import { useTryOnStore } from "@/store/tryOnStore";
import { useUiStore } from "@/store/uiStore";
import { useVoiceStore } from "@/store/voiceStore";

const HINT: Partial<Record<FramingState, string>> = {
  "no-face": "कैमरे की तरफ़ देखिए",
  "too-far": "थोड़ा पास आइए",
  "too-close": "थोड़ा पीछे हटिए",
};

/** A hint must hold this long before it shows (no flicker on brief misses). */
const HINT_DELAY_MS = 1200;

/**
 * The only coaching a customer needs: look at the camera, come closer, step
 * back — on the mirror, in Hindi, after a short delay. Fit size is measured
 * silently in the background (useAutoFitCalibration); its controls are staff
 * tools. Hidden while the welcome greeting is showing.
 */
export function FramingHint() {
  const trackingStatus = useTryOnStore((s) => s.trackingStatus);
  const attract = useVoiceStore((s) => s.phase === "off" && s.suggestions.length === 0);
  const framing = useFraming(trackingStatus === "ready");
  const message = HINT[framing.state] ?? null;
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!message) {
      setShown(null);
      return;
    }
    const id = setTimeout(() => setShown(message), HINT_DELAY_MS);
    return () => clearTimeout(id);
  }, [message]);

  if (!shown || attract || trackingStatus !== "ready") return null;
  return (
    // At the top of the mirror, above the frame dial.
    <div className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center px-4 sm:top-4">
      <span
        key={shown}
        className="hint-in rounded-full bg-black/45 px-4 py-2 text-base font-medium text-white shadow-lg backdrop-blur-md sm:text-lg"
        role="status"
      >
        {shown}
      </span>
    </div>
  );
}

/** Hold this long on the wordmark to switch staff tools on/off. */
const STAFF_HOLD_MS = 1500;

/**
 * Wordmark in the mirror's corner. Pressing and holding it toggles staff
 * tools (also: Ctrl+Shift+S, or ?staff=1 / ?staff=0 in the URL).
 */
export function BrandMark() {
  const staffMode = useUiStore((s) => s.staffMode);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);

  const start = () => {
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      useUiStore.getState().setStaffMode(!useUiStore.getState().staffMode);
    }, STAFF_HOLD_MS);
  };
  const cancel = () => {
    setHolding(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <div
      className="pointer-events-auto absolute left-3 top-3 z-50 select-none sm:left-4 sm:top-4"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span
        className={`text-[11px] font-semibold uppercase tracking-[0.28em] drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)] transition-colors duration-700 sm:text-xs ${
          holding ? "text-amber-300" : "text-white/85"
        }`}
      >
        EyeNetra
      </span>
      {staffMode ? (
        <span className="ml-2 rounded bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-900">
          Staff
        </span>
      ) : null}
      <DevFpsReadout />
    </div>
  );
}
