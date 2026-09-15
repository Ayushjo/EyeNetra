"use client";

import { useEffect, useRef } from "react";
import { useFaceCalibration } from "@/hooks/useFaceCalibration";
import { clearFaceProfile, loadFaceProfile } from "@/lib/faceProfile";
import { useTryOnStore } from "@/store/tryOnStore";

export function FitCalibration() {
  const faceProfile = useTryOnStore((s) => s.faceProfile);
  const setFaceProfile = useTryOnStore((s) => s.setFaceProfile);
  const hasFace = useTryOnStore((s) => s.hasFace);
  const trackingProviderId = useTryOnStore((s) => s.trackingProviderId);
  const { status, progress, error, calibrate, isCapturing } =
    useFaceCalibration();

  const canCalibrate =
    hasFace && trackingProviderId === "mediapipe";
  const hydrated = useRef(false);

  // Hydrate once from localStorage — do NOT re-run when faceProfile flips
  // (that previously fought Clear / HMR and looked like silent re-calibration).
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (useTryOnStore.getState().faceProfile) return;
    const stored = loadFaceProfile();
    if (stored) {
      console.info("[EyeNetra:calib:write] hydrate from localStorage", {
        ipdMm: stored.ipdMm,
        faceWidthMm: stored.faceWidthMm,
        refEyeSpanScene: stored.refEyeSpanScene,
      });
      setFaceProfile(stored);
    }
  }, [setFaceProfile]);

  const onClear = () => {
    clearFaceProfile();
    setFaceProfile(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
      <button
        type="button"
        onClick={() => void calibrate()}
        disabled={isCapturing || !canCalibrate}
        className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        {isCapturing
          ? `Measuring… ${Math.round(progress * 100)}%`
          : faceProfile
            ? "Recalibrate fit size"
            : "Get your fit size"}
      </button>

      {trackingProviderId === "jeeliz" ? (
        <span className="text-xs text-amber-700/90">
          Jeeliz is experimental — size/pose won’t match Meta. Use MediaPipe for
          accurate try-on.
        </span>
      ) : faceProfile ? (
        <span className="text-xs text-zinc-500">
          Fit locked · outer-canthi {faceProfile.faceWidthMm.toFixed(0)} mm ·
          IPD {faceProfile.ipdMm.toFixed(0)} mm
          <button
            type="button"
            onClick={onClear}
            className="ml-2 underline hover:text-zinc-800"
          >
            Clear
          </button>
        </span>
      ) : (
        <span className="text-xs text-amber-700/90">
          Tip: Get your fit size once (face camera, hold still) for Meta-like
          frame width.
        </span>
      )}

      {status === "success" && faceProfile ? (
        <span className="text-xs text-emerald-700">Saved — reload keeps it.</span>
      ) : null}
      {status === "error" && error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : null}

      {isCapturing ? (
        <div
          className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-zinc-200"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-emerald-700 transition-[width] duration-100"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
