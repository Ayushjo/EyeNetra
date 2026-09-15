"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Quaternion, Vector3, type Object3D } from "three";
import { computePose } from "@/lib/fitPose";
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
    } = state;

    const providerKey = trackingProviderId ?? "mediapipe";
    if (
      lastFrameId.current !== selectedFrameId ||
      lastProvider.current !== providerKey
    ) {
      lastFrameId.current = selectedFrameId;
      lastProvider.current = providerKey;
      initialized.current = false;
      loggedApply.current = false;
      loggedPoseNull.current = false;
    }

    const nowMs = performance.now();

    let pos: { x: number; y: number; z: number } | null = null;
    let rot: { x: number; y: number; z: number; w: number } | null = null;
    let scale: number | null = null;
    let liveScale: number | null = null;
    let calibScale: number | null = null;
    let faceOk = false;

    if (providerKey === "mediapipe") {
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
    const a = Math.min(1, Math.max(0.08, smoothingFactor));

    if (!initialized.current) {
      smoothPos.current.set(pos.x, pos.y, pos.z);
      smoothQuat.current.set(rot.x, rot.y, rot.z, rot.w);
      smoothScale.current = scale;
      initialized.current = true;
    } else {
      smoothPos.current.lerp(new Vector3(pos.x, pos.y, pos.z), a);
      smoothQuat.current.slerp(
        new Quaternion(rot.x, rot.y, rot.z, rot.w),
        a,
      );
      smoothScale.current = smoothScale.current * (1 - a) + scale * a;
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
