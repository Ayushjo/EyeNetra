"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Quaternion, Vector3, type Object3D } from "three";
import { computePose } from "@/lib/fitPose";
import { OneEuroQuat, OneEuroScalar, OneEuroVec } from "@/lib/oneEuro";
import { predictPose, PREDICT_MAX_MS } from "@/lib/posePredict";
import { useTryOnStore } from "@/store/tryOnStore";

export type { FitPose } from "@/lib/fitPose";
export { landmarkToWorld } from "@/lib/coords";

function rollingStd(samples: number[]): number {
  if (samples.length < 2) return 0;
  let sum = 0;
  for (const v of samples) sum += v;
  const mean = sum / samples.length;
  let varSum = 0;
  for (const v of samples) {
    const d = v - mean;
    varSum += d * d;
  }
  return Math.sqrt(varSum / samples.length);
}

/**
 * Applies pose onto the glasses anchor.
 *
 * MediaPipe (product path): prefer TrackingFrame (provider already ran
 * computePose). Fallback: recompute from store landmarks+matrix.
 * Jeeliz (dev): use TrackingFrame only.
 */
export function useFitEngine(targetRef: React.RefObject<Object3D | null>) {
  const smoothPos = useRef(new Vector3());
  const smoothQuat = useRef(new Quaternion());
  const smoothScale = useRef(1);
  const initialized = useRef(false);

  // One-euro filters: adaptive smoothing (still = smooth, moving = responsive).
  const posFilter = useRef(new OneEuroVec(3, 1.4, 0.03));
  const quatFilter = useRef(new OneEuroQuat(2.0, 0.6));
  const scaleFilter = useRef(new OneEuroScalar(1.0, 0.01));
  const posBuf = useRef<number[]>([0, 0, 0]);
  const quatBuf = useRef<number[]>([0, 0, 0, 1]);
  // Last two RAW samples (video timestamps) for constant-velocity prediction.
  const rawPos0 = useRef(new Vector3());
  const rawQuat0 = useRef(new Quaternion());
  const rawT0 = useRef(0);
  const rawPos1 = useRef(new Vector3());
  const rawQuat1 = useRef(new Quaternion());
  const rawT1 = useRef(0);
  const lastSampleT = useRef<number | null>(null);
  const lastDetectedAt = useRef(0);
  const lastFrameId = useRef<string | null>(null);
  const lastProvider = useRef<string | null>(null);
  const lastFaceSeenAt = useRef(0);
  const loggedApply = useRef(false);
  const loggedPoseNull = useRef(false);
  const FACE_LOSS_GRACE_MS = 400;

  const liveScaleWindow = useRef<number[]>([]);
  const calibScaleWindow = useRef<number[]>([]);
  const lastCalibLogMs = useRef(0);
  const windowStartMs = useRef(0);

  useFrame(() => {
    const target = targetRef.current;
    if (!target) return;

    const state = useTryOnStore.getState();
    const {
      trackingFrame,
      landmarks,
      transformMatrix,
      hasFace,
      videoWidth,
      videoHeight,
      smoothingFactor,
      selectedFrameId,
      debugPoseLog,
      faceProfile,
      trackingProviderId,
      renderMode,
    } = state;

    const providerKey = trackingProviderId ?? "mediapipe";
    const filterKey = `${providerKey}:${renderMode}`;
    if (
      lastFrameId.current !== selectedFrameId ||
      lastProvider.current !== filterKey
    ) {
      lastFrameId.current = selectedFrameId;
      lastProvider.current = filterKey;
      initialized.current = false;
      loggedApply.current = false;
      loggedPoseNull.current = false;
      posFilter.current.reset();
      quatFilter.current.reset();
      scaleFilter.current.reset();
      lastSampleT.current = null;
    }

    const nowMs = performance.now();

    let pos: { x: number; y: number; z: number } | null = null;
    let rot: { x: number; y: number; z: number; w: number } | null = null;
    let scale: number | null = null;
    let liveScale: number | null = null;
    let calibScale: number | null = null;
    let faceOk = false;

    if (providerKey === "mediapipe" && renderMode === "perspective") {
      // Metric perspective path — the provider computes the anatomical pose
      // once per detection (buildTrackingFrame); we only filter it here.
      if (trackingFrame?.anchorPose) {
        faceOk = true;
        pos = trackingFrame.anchorPose.position;
        rot = trackingFrame.anchorPose.rotation;
        scale = trackingFrame.anchorPose.scale;
        liveScale = trackingFrame.anchorPose.scale;
        calibScale = null;
      }
    } else if (providerKey === "mediapipe") {
      // Prefer provider frame — avoids hide when store recompute races / fails.
      if (trackingFrame?.hasFace) {
        faceOk = true;
        pos = trackingFrame.position;
        rot = trackingFrame.rotation;
        scale = trackingFrame.scale;
        liveScale = trackingFrame.liveScale;
        calibScale = trackingFrame.calibScale;
      } else if (hasFace && landmarks && landmarks.length >= 478) {
        const sku = state.selectedFrame();
        const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
        const pose = computePose({
          landmarks,
          transformMatrix,
          aspect,
          scaleMul: sku.fit.scaleMul,
          yOffsetFrac: sku.fit.yOffsetFrac,
          frameWidthMm: sku.fit.frameWidthMm,
          faceProfile,
          debugLog: debugPoseLog,
        });
        if (pose) {
          faceOk = true;
          pos = {
            x: pose.position.x,
            y: pose.position.y,
            z: pose.position.z,
          };
          rot = {
            x: pose.quaternion.x,
            y: pose.quaternion.y,
            z: pose.quaternion.z,
            w: pose.quaternion.w,
          };
          scale = pose.scale;
          liveScale = pose.liveScale;
          calibScale = pose.calibScale;
        } else if (!loggedPoseNull.current) {
          loggedPoseNull.current = true;
          console.warn(
            `[EyeNetra:fit] MediaPipe face locked but pose null — matrixLen=${transformMatrix?.length ?? 0} landmarks=${landmarks.length} (need iris 468/473 + 16-float matrix)`,
          );
        }
      } else if (hasFace && !loggedPoseNull.current) {
        loggedPoseNull.current = true;
        console.warn(
          `[EyeNetra:fit] MediaPipe hasFace but no usable frame — landmarks=${landmarks?.length ?? 0} trackingFrame.hasFace=${trackingFrame?.hasFace ?? false}`,
        );
      }
    } else if (trackingFrame?.hasFace) {
      faceOk = true;
      pos = trackingFrame.position;
      rot = trackingFrame.rotation;
      scale = trackingFrame.scale;
      liveScale = trackingFrame.liveScale;
      calibScale = trackingFrame.calibScale;
    }

    if (!faceOk || !pos || !rot || scale == null || liveScale == null) {
      if (nowMs - lastFaceSeenAt.current > FACE_LOSS_GRACE_MS) {
        target.visible = false;
        initialized.current = false;
      }
      return;
    }
    lastFaceSeenAt.current = nowMs;

    if (debugPoseLog) {
      if (windowStartMs.current === 0) windowStartMs.current = nowMs;
      liveScaleWindow.current.push(liveScale);
      if (calibScale != null) {
        calibScaleWindow.current.push(calibScale);
      }
      if (nowMs - windowStartMs.current >= 1000) {
        if (nowMs - lastCalibLogMs.current >= 1000) {
          lastCalibLogMs.current = nowMs;
          const liveσ = rollingStd(liveScaleWindow.current);
          const hasProfile = !!faceProfile?.refEyeSpanScene;
          const nCalib = calibScaleWindow.current.length;
          const calibσ =
            nCalib > 1 ? rollingStd(calibScaleWindow.current) : null;
          const calibPart = !hasProfile
            ? " calibScaleσ=n/a (no profile)"
            : calibσ != null
              ? ` calibScaleσ=${calibσ.toFixed(4)} (frozen n=${nCalib})`
              : " calibScaleσ=n/a (profile but <2 samples)";
          console.info(
            `[EyeNetra:calib] liveScaleσ=${liveσ.toFixed(4)}${calibPart} n=${liveScaleWindow.current.length}`,
          );
        }
        liveScaleWindow.current = [];
        calibScaleWindow.current = [];
        windowStartMs.current = nowMs;
      }
    }

    target.visible = true;

    // smoothingFactor slider (0.05..1) modulates one-euro responsiveness:
    // higher = snappier (tracks fast motion), lower = glassier (max de-jitter).
    const resp = Math.min(1, Math.max(0.05, smoothingFactor));
    // Filter on the VIDEO timestamp when the provider supplies it — filtering
    // with render time re-ingests the same 30 fps sample at 60 fps, biasing
    // the derivative toward 0 (hidden lag).
    const sampleTMs = trackingFrame?.timestampMs ?? nowMs;
    const t = sampleTMs / 1000;
    const isNewSample = lastSampleT.current !== sampleTMs;
    // Map slider → one-euro min cutoff + beta. resp 0.05→glassy, 1→snappy.
    const posMin = 0.6 + resp * 2.4;
    const posBeta = 0.01 + resp * 0.05;
    posFilter.current.setParams(posMin, posBeta);
    // Quat cutoff in the same family; beta scales with angular speed (rad/s).
    quatFilter.current.setParams(posMin * 1.3, 0.3 + resp * 0.6);
    // Scale must chase distance changes fast — a laggy scale reads as "frame
    // too big when I move back" (face shrinks instantly, frame catches up
    // slowly). High beta = snaps during motion, still smooth at rest.
    scaleFilter.current.setParams(1.6 + resp * 2.4, 0.06 + resp * 0.08);

    if (!initialized.current) {
      posFilter.current.reset();
      quatFilter.current.reset();
      scaleFilter.current.reset();
      smoothPos.current.set(pos.x, pos.y, pos.z);
      smoothQuat.current.set(rot.x, rot.y, rot.z, rot.w).normalize();
      smoothScale.current = scale;
      rawPos1.current.copy(smoothPos.current);
      rawQuat1.current.copy(smoothQuat.current);
      rawT1.current = sampleTMs;
      rawT0.current = 0;
      lastSampleT.current = sampleTMs;
      lastDetectedAt.current = trackingFrame?.detectedAtMs ?? nowMs;
      initialized.current = true;
    } else if (isNewSample) {
      lastSampleT.current = sampleTMs;
      lastDetectedAt.current = trackingFrame?.detectedAtMs ?? nowMs;

      // Shift the raw-sample window for prediction.
      rawPos0.current.copy(rawPos1.current);
      rawQuat0.current.copy(rawQuat1.current);
      rawT0.current = rawT1.current;
      rawPos1.current.set(pos.x, pos.y, pos.z);
      rawQuat1.current.set(rot.x, rot.y, rot.z, rot.w).normalize();
      rawT1.current = sampleTMs;

      const pb = posFilter.current.filter(
        t,
        [pos.x, pos.y, pos.z],
        posBuf.current,
      );
      smoothPos.current.set(pb[0], pb[1], pb[2]);

      const qb = quatFilter.current.filter(
        t,
        [rot.x, rot.y, rot.z, rot.w],
        quatBuf.current,
      );
      smoothQuat.current.set(qb[0], qb[1], qb[2], qb[3]);

      smoothScale.current = scaleFilter.current.filter(t, scale);
    }
    // Same sample as last render frame → no filter ingestion; prediction
    // below carries the pose between detections.

    target.position.copy(smoothPos.current);
    target.quaternion.copy(smoothQuat.current);
    // Post-filter constant-velocity prediction hides pipeline latency.
    // Scaled down as the smoothing slider goes glassy.
    if (rawT0.current > 0) {
      const predictMs =
        Math.min(PREDICT_MAX_MS, Math.max(0, nowMs - lastDetectedAt.current)) *
        resp;
      predictPose(
        rawPos0.current,
        rawQuat0.current,
        rawT0.current,
        rawPos1.current,
        rawQuat1.current,
        rawT1.current,
        predictMs,
        target.position,
        target.quaternion,
      );
    }
    target.scale.setScalar(smoothScale.current);

    if (providerKey === "mediapipe") {
      useTryOnStore.getState().setLastMediapipeScale(smoothScale.current);
    }

    if (!loggedApply.current) {
      loggedApply.current = true;
      console.info(
        `[EyeNetra:fit] apply provider=${providerKey} pos=(${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}) scale=${scale.toFixed(3)} visible=true`,
      );
    }
  });
}
