"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CALIB_DURATION_MS,
  CALIB_TARGET_FRAMES,
  buildProfileFromMeasures,
  measureFacePx,
  saveFaceProfile,
  type FaceMeasurePx,
  type FaceProfile,
} from "@/lib/faceProfile";
import { outerEyeSpanScene } from "@/lib/fitPose";
import { useTryOnStore } from "@/store/tryOnStore";

export type CalibrationStatus =
  | "idle"
  | "capturing"
  | "success"
  | "error";

/** Module-level lock survives React remounts / Strict Mode / Fast Refresh. */
let calibInFlight = false;

/**
 * Burst-sample live landmarks from the store (same FaceLandmarker stream).
 * Filters motion outliers, averages IPD / face width via iris 11.7 mm,
 * and freezes refEyeSpanScene for stable scale.
 */
export function useFaceCalibration() {
  const [status, setStatus] = useState<CalibrationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastProfile, setLastProfile] = useState<FaceProfile | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const calibrate = useCallback(async () => {
    if (calibInFlight) {
      console.info(
        "[EyeNetra:calib:write] calibrate() ignored — already in flight",
      );
      return;
    }
    calibInFlight = true;
    setStatus("capturing");
    setError(null);
    setProgress(0);
    console.info("[EyeNetra:calib:write] calibrate() START (user or caller)");

    const measures: FaceMeasurePx[] = [];
    const start = performance.now();
    const intervalMs = CALIB_DURATION_MS / CALIB_TARGET_FRAMES;

    try {
      while (performance.now() - start < CALIB_DURATION_MS) {
        const { landmarks, hasFace, videoWidth, videoHeight } =
          useTryOnStore.getState();
        if (hasFace && landmarks && landmarks.length > 476) {
          const aspect =
            videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
          const span = outerEyeSpanScene(landmarks, aspect);
          const m = measureFacePx(landmarks, span);
          if (m) measures.push(m);
        }
        const elapsed = performance.now() - start;
        if (mounted.current) {
          setProgress(Math.min(1, elapsed / CALIB_DURATION_MS));
        }
        await new Promise<void>((r) => setTimeout(r, intervalMs));
      }

      const profile = buildProfileFromMeasures(measures);
      if (!profile) {
        if (mounted.current) {
          setStatus("error");
          setError("Hold still and retry — not enough steady frames.");
          setProgress(0);
        }
        return;
      }

      saveFaceProfile(profile);
      useTryOnStore.getState().setFaceProfile(profile);
      if (mounted.current) {
        setLastProfile(profile);
        setStatus("success");
        setProgress(1);
      }
      console.info(
        `[EyeNetra:calib] saved faceProfile ipdMm=${profile.ipdMm.toFixed(1)} faceWidthMm=${profile.faceWidthMm.toFixed(1)} refSpan=${profile.refEyeSpanScene.toFixed(3)} kept=${measures.length}`,
      );
    } catch (e) {
      if (mounted.current) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Calibration failed");
        setProgress(0);
      }
    } finally {
      calibInFlight = false;
    }
  }, []);

  const resetStatus = useCallback(() => {
    if (status === "success" || status === "error") {
      setStatus("idle");
      setError(null);
      setProgress(0);
    }
  }, [status]);

  return {
    status,
    progress,
    error,
    lastProfile,
    calibrate,
    resetStatus,
    isCapturing: status === "capturing",
  };
}
