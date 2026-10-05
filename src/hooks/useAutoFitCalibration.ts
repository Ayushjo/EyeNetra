"use client";

import { useEffect, useRef } from "react";
import { applyCalibration } from "@/lib/calibrationPipeline";
import {
  CALIB_MIN_EYE_OPENNESS,
  measureFacePx,
  robustProfileFromMeasures,
  type FaceMeasurePx,
} from "@/lib/faceProfile";
import { outerEyeSpanScene } from "@/lib/fitPose";
import { isFrontalHeadPose, type AnchorSample } from "@/lib/headAnchors";
import { useTryOnStore } from "@/store/tryOnStore";

/** Samples needed before a measurement is trusted. */
export const AUTO_CALIB_MIN_SAMPLES = 40;
/** Keep the most recent N qualifying samples (sliding window). */
export const AUTO_CALIB_WINDOW = 80;
/** Robust σ of canthal width (mm) that counts as a good measurement. */
export const AUTO_CALIB_MAX_SIGMA_MM = 1.0;
/** Usable head distance (cm): too far → iris is a few pixels, too near → distortion. */
export const AUTO_CALIB_DEPTH_CM: [number, number] = [25, 75];
const SAMPLE_EVERY_MS = 100;
/** Re-measure only if a later window is clearly tighter. */
const IMPROVE_FACTOR = 0.8;

/**
 * Zero-interaction fit-size calibration. A customer will not hold a card or
 * press a button, so this samples the live tracking whenever the frame
 * qualifies — near-frontal, eyes open, in range, consecutive distinct
 * detections — and applies a median-based measurement once ≥40 samples
 * agree to σ < 1 mm. It keeps watching afterwards and only replaces the
 * measurement with a clearly tighter one. Progress is published to the store
 * so the UI can say "measuring… n/40 · σ 1.4 mm" instead of asking for a scan.
 */
export function useAutoFitCalibration(enabled: boolean) {
  const measures = useRef<FaceMeasurePx[]>([]);
  const samples = useRef<AnchorSample[]>([]);
  const lastTs = useRef(-Infinity);
  const bestSigma = useRef<number>(Infinity);

  useEffect(() => {
    if (!enabled) return;
    measures.current = [];
    samples.current = [];
    lastTs.current = -Infinity;
    const id = setInterval(() => {
      const state = useTryOnStore.getState();
      const tf = state.trackingFrame;
      if (!tf || !tf.hasFace || !tf.landmarks || tf.landmarks.length < 478 || !tf.transformMatrix) return;
      if (tf.timestampMs == null || tf.timestampMs <= lastTs.current) return;
      const depth = tf.depthCm ?? 0;
      if (depth < AUTO_CALIB_DEPTH_CM[0] || depth > AUTO_CALIB_DEPTH_CM[1]) return;
      if (!isFrontalHeadPose(tf.transformMatrix)) return;
      const aspect = tf.videoWidth / tf.videoHeight;
      const m = measureFacePx(tf.landmarks, outerEyeSpanScene(tf.landmarks, aspect), tf.videoWidth, tf.videoHeight);
      if (!m || m.eyeOpenness < CALIB_MIN_EYE_OPENNESS) return;
      lastTs.current = tf.timestampMs;
      measures.current.push(m);
      samples.current.push({ landmarks: tf.landmarks, transformMatrix: tf.transformMatrix });
      if (measures.current.length > AUTO_CALIB_WINDOW) {
        measures.current.shift();
        samples.current.shift();
      }
      const robust = robustProfileFromMeasures(measures.current, Math.min(AUTO_CALIB_MIN_SAMPLES, 10));
      const n = measures.current.length;
      const sigma = robust?.sigmaMm ?? null;
      state.setAutoCalib({ n, sigmaMm: sigma, applied: bestSigma.current < Infinity });
      if (!robust || n < AUTO_CALIB_MIN_SAMPLES || robust.sigmaMm > AUTO_CALIB_MAX_SIGMA_MM) return;
      if (robust.sigmaMm >= bestSigma.current * IMPROVE_FACTOR) return;
      bestSigma.current = robust.sigmaMm;
      applyCalibration(robust.profile, samples.current.slice(), aspect);
      console.info(
        `[EyeNetra:autocalib] applied faceWidth=${robust.profile.faceWidthMm.toFixed(1)}mm σ=${robust.sigmaMm.toFixed(2)}mm n=${robust.n}`,
      );
      state.setAutoCalib({ n, sigmaMm: robust.sigmaMm, applied: true });
    }, SAMPLE_EVERY_MS);
    return () => clearInterval(id);
  }, [enabled]);
}
