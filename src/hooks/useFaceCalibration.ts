"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CALIB_DURATION_MS,
  CALIB_TARGET_FRAMES,
  buildProfileFromMeasures,
  measureFacePx,
  saveFaceProfile,
  stableMeasureIndices,
  type FaceMeasurePx,
  type FaceProfile,
} from "@/lib/faceProfile";
import { outerEyeSpanScene } from "@/lib/fitPose";
import {
  computeScaleCorrection,
  estimateFocalFit,
  saveCameraCalib,
} from "@/lib/cameraCalib";
import { canonicalHeadAnchors, clearHeadAnchors, isFrontalHeadPose, refineHeadAnchors, saveHeadAnchors, type AnchorSample } from "@/lib/headAnchors";
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
    const samples: AnchorSample[] = [];
    let lastAspect = 16 / 9;
    let lastTimestampMs = -Infinity;
    const start = performance.now();
    const intervalMs = CALIB_DURATION_MS / CALIB_TARGET_FRAMES;

    try {
      while (performance.now() - start < CALIB_DURATION_MS) {
        const { trackingFrame } =
          useTryOnStore.getState();
        const { landmarks, hasFace, videoWidth, videoHeight, transformMatrix, timestampMs } =
          trackingFrame ?? {};
        if (
          hasFace && landmarks && landmarks.length > 476 && transformMatrix &&
          typeof videoWidth === "number" && videoWidth > 0 &&
          typeof videoHeight === "number" && videoHeight > 0 &&
          timestampMs != null && Number.isFinite(timestampMs) &&
          timestampMs > lastTimestampMs && isFrontalHeadPose(transformMatrix)
        ) {
          lastTimestampMs = timestampMs;
          const aspect = videoWidth / videoHeight;
          lastAspect = aspect;
          const span = outerEyeSpanScene(landmarks, aspect);
          const m = measureFacePx(landmarks, span, videoWidth, videoHeight);
          if (m) {
            measures.push(m);
            samples.push({ landmarks, transformMatrix });
          }
        }
        const elapsed = performance.now() - start;
        if (mounted.current) {
          setProgress(Math.min(1, elapsed / CALIB_DURATION_MS));
        }
        await new Promise<void>((r) => setTimeout(r, intervalMs));
      }

      const keptIndices = stableMeasureIndices(measures);
      const stableMeasures = keptIndices.map((i) => measures[i]);
      const stableSamples = keptIndices.map((i) => samples[i]);
      const profile = buildProfileFromMeasures(stableMeasures);
      if (!profile) {
        if (mounted.current) {
          setStatus("error");
          setError("Face the camera and hold still — not enough distinct steady frames.");
          setProgress(0);
        }
        return;
      }

      saveFaceProfile(profile);
      const store = useTryOnStore.getState();
      store.setFaceProfile(profile);

      // Camera correctness: solver-FOV self-check + iris scale correction,
      // averaged over the same burst frames.
      const fovDeg = store.cameraCalib.fovDeg;
      let rms: number | null = null;
      if (stableSamples.length) {
        const last = stableSamples[stableSamples.length - 1];
        const focal = estimateFocalFit(
          last.landmarks,
          last.transformMatrix,
          lastAspect,
        );
        if (focal) {
          rms = focal.rms;
          console.info(
            `[EyeNetra:calib] solver-FOV self-check: fit=${focal.fovDeg.toFixed(1)}° (render=${fovDeg}°) rms=${focal.rms.toFixed(4)}`,
          );
        }
        let corrSum = 0;
        let corrN = 0;
        for (const s of stableSamples) {
          const c = computeScaleCorrection(
            s.landmarks,
            s.transformMatrix,
            lastAspect,
            fovDeg,
            profile,
          );
          if (c !== 1) {
            corrSum += c;
            corrN++;
          }
        }
        const scaleCorrection = corrN
          ? Math.min(1.4, Math.max(0.7, corrSum / corrN))
          : 1;
        store.setCameraCalib({ scaleCorrection, rms });
        saveCameraCalib({ fovDeg, scaleCorrection, rms });
        console.info(
          `[EyeNetra:calib] scaleCorrection=${scaleCorrection.toFixed(3)} (n=${corrN})`,
        );

        // Per-user anatomical anchor refinement.
        const refined = refineHeadAnchors(
          stableSamples,
          lastAspect,
          fovDeg,
          canonicalHeadAnchors(store.tragionTune),
        );
        if (refined) {
          store.setHeadAnchors(refined);
          saveHeadAnchors(refined);
          console.info(
            `[EyeNetra:calib] headAnchors calibrated: seat=(${refined.seatHeadCm.x.toFixed(2)}, ${refined.seatHeadCm.y.toFixed(2)}, ${refined.seatHeadCm.z.toFixed(2)})cm`,
          );
        }
        else {
          store.setHeadAnchors(canonicalHeadAnchors(store.tragionTune));
          clearHeadAnchors();
        }
      }
      if (mounted.current) {
        setLastProfile(profile);
        setStatus("success");
        setProgress(1);
      }
      console.info(
        `[EyeNetra:calib] saved faceProfile ipdMm=${profile.ipdMm.toFixed(1)} faceWidthMm=${profile.faceWidthMm.toFixed(1)} refSpan=${profile.refEyeSpanScene.toFixed(3)} kept=${stableSamples.length}`,
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
