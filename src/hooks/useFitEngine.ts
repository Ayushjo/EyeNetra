"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Quaternion, Vector3, type Object3D } from "three";
import { computePose, computePosePerspective } from "@/lib/fitPose";
import { OneEuroScalar, OneEuroVec } from "@/lib/oneEuro";
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
  const quatFilter = useRef(new OneEuroVec(4, 2.0, 0.04));
  const scaleFilter = useRef(new OneEuroScalar(1.0, 0.01));
  const posBuf = useRef<number[]>([0, 0, 0]);
  const quatBuf = useRef<number[]>([0, 0, 0, 1]);
  const prevQuat = useRef(new Quaternion());
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
      perspTune,
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
    }

    const nowMs = performance.now();

    let pos: { x: number; y: number; z: number } | null = null;
    let rot: { x: number; y: number; z: number; w: number } | null = null;
    let scale: number | null = null;
    let liveScale: number | null = null;
    let calibScale: number | null = null;
    let faceOk = false;

    if (providerKey === "mediapipe" && renderMode === "perspective") {
      // Metric perspective path — computed here so the render-mode toggle is
      // instant (no provider restart). Uses store landmarks + matrix.
      if (hasFace && landmarks && landmarks.length >= 468 && transformMatrix) {
        const sku = state.selectedFrame();
        const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
        // Per-frame baked offsets + dev-slider delta (sliders default to the
        // same base so an untouched slider is a no-op).
        const baseY = sku.fit.perspYOffsetCm ?? 0.8;
        const baseZ = sku.fit.perspZOffsetCm ?? 0.6;
        const baseScale = sku.fit.perspScaleTune ?? 1.0;
        const pose = computePosePerspective({
          landmarks,
          transformMatrix,
          aspect,
          frameWidthMm: sku.fit.frameWidthMm,
          scaleTune: baseScale * perspTune.scaleTune,
          yOffsetCm: baseY + (perspTune.yOffsetCm - 0.8),
          zOffsetCm: baseZ + (perspTune.zOffsetCm - 0.6),
          debugLog: debugPoseLog,
        });
        if (pose) {
          faceOk = true;
          pos = { x: pose.position.x, y: pose.position.y, z: pose.position.z };
          rot = {
            x: pose.quaternion.x,
            y: pose.quaternion.y,
            z: pose.quaternion.z,
            w: pose.quaternion.w,
          };
          scale = pose.scale;
          liveScale = pose.liveScale;
          calibScale = pose.calibScale;
        }
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
    const t = nowMs / 1000;
    // Map slider → one-euro min cutoff + beta. resp 0.05→glassy, 1→snappy.
    const posMin = 0.6 + resp * 2.4;
    const posBeta = 0.01 + resp * 0.05;
    posFilter.current.setParams(posMin, posBeta);
    quatFilter.current.setParams(posMin * 1.3, posBeta * 1.3);
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
      prevQuat.current.copy(smoothQuat.current);
      initialized.current = true;
    } else {
      const pb = posFilter.current.filter(
        t,
        [pos.x, pos.y, pos.z],
        posBuf.current,
      );
      smoothPos.current.set(pb[0], pb[1], pb[2]);

      // Keep quaternion on the same hemisphere as the last output before
      // component-wise filtering, else sign flips cause a visible snap.
      let qx = rot.x;
      let qy = rot.y;
      let qz = rot.z;
      let qw = rot.w;
      if (
        prevQuat.current.x * qx +
          prevQuat.current.y * qy +
          prevQuat.current.z * qz +
          prevQuat.current.w * qw <
        0
      ) {
        qx = -qx;
        qy = -qy;
        qz = -qz;
        qw = -qw;
      }
      const qb = quatFilter.current.filter(t, [qx, qy, qz, qw], quatBuf.current);
      smoothQuat.current.set(qb[0], qb[1], qb[2], qb[3]).normalize();
      prevQuat.current.copy(smoothQuat.current);

      smoothScale.current = scaleFilter.current.filter(t, scale);
    }

    target.position.copy(smoothPos.current);
    target.quaternion.copy(smoothQuat.current);
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
