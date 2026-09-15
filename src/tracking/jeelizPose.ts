/**
 * Map Jeeliz FaceFilter detectState → TrackingFrame for our orthographic overlay.
 *
 * FaceFilter has NO iris landmarks. Accurate size after MediaPipe calibration
 * uses a session cross-bind:
 *   scale = scale0 * (detect.s / sRef)
 * where scale0 is the last MediaPipe fit scale (or mm-derived base) and sRef is
 * Jeeliz `s` averaged at bind time — so at switch distance size matches MediaPipe
 * exactly, and lean-in scales with `s`.
 */
import { Euler, Quaternion, Vector3 } from "three";
import type { FaceProfile } from "@/lib/faceProfile";
import type { TrackingFrame } from "@/tracking/types";

export type JeelizDetectState = {
  detected: number;
  x: number;
  y: number;
  s: number;
  rx: number;
  ry: number;
  rz: number;
};

/** Bound once per Jeeliz session after MediaPipe (or mm) scale transfer. */
export type JeelizScaleBind = {
  /** Scene scale that matched MediaPipe (or mm base) at bind. */
  scale0: number;
  /** Averaged Jeeliz detect.s at bind. */
  sRef: number;
};

export type JeelizPoseInput = {
  detect: JeelizDetectState;
  videoWidth: number;
  videoHeight: number;
  scaleMul: number;
  yOffsetFrac: number;
  frameWidthMm: number;
  faceProfile: FaceProfile | null;
  /** Cross-calibrated MediaPipe→Jeeliz scale bridge for this session. */
  scaleBind?: JeelizScaleBind | null;
  /** While sampling sRef, hold this scene scale (last MediaPipe / mm base). */
  holdScale?: number | null;
  /** CSS mirrored video — flip yaw like MediaPipe path. */
  mirrorVideo?: boolean;
};

const _q = new Quaternion();
const _e = new Euler();

export const JEELIZ_CANTHI_FRAC = 0.58;

export function jeelizEyeSpanScene(s: number, aspect: number): number {
  return Math.max(1e-4, s * 2 * aspect * JEELIZ_CANTHI_FRAC);
}

/** Mm-correct scale at MediaPipe calibration distance (no Jeeliz `s`). */
export function mediapipeCalibBaseScale(
  frameWidthMm: number,
  faceProfile: FaceProfile,
): number {
  return Math.min(
    2.8,
    Math.max(
      0.2,
      (frameWidthMm / faceProfile.faceWidthMm) * faceProfile.refEyeSpanScene,
    ),
  );
}

export function jeelizDetectToFrame(input: JeelizPoseInput): TrackingFrame {
  const {
    detect,
    videoWidth,
    videoHeight,
    scaleMul,
    yOffsetFrac,
    frameWidthMm,
    faceProfile,
    scaleBind = null,
    holdScale = null,
    mirrorVideo = true,
  } = input;

  const hasFace = detect.detected > 0.6;
  if (!hasFace) {
    return {
      hasFace: false,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: 1,
      liveScale: 1,
      calibScale: null,
      videoWidth,
      videoHeight,
    };
  }

  let rx = detect.rx;
  let ry = detect.ry;
  let rz = detect.rz;
  let x = detect.x;
  let y = detect.y;
  if (mirrorVideo) {
    ry = -ry;
    rz = -rz;
    x = -x;
  }
  // JeelizThreeHelper rotation order.
  _e.set(rx, ry, rz, "ZYX");
  _q.setFromEuler(_e);

  const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
  const eyeSpan = jeelizEyeSpanScene(detect.s, aspect);
  const liveScale = Math.min(2.8, Math.max(0.2, eyeSpan * scaleMul));

  let scale = liveScale;
  let calibScale: number | null = null;

  if (scaleBind && scaleBind.sRef > 1e-6 && scaleBind.scale0 > 0) {
    // Pixel-match MediaPipe at bind distance; track lean-in via s/sRef.
    calibScale = Math.min(
      2.8,
      Math.max(0.2, scaleBind.scale0 * (detect.s / scaleBind.sRef)),
    );
    scale = calibScale;
  } else if (holdScale && holdScale > 0) {
    // Binding in progress — freeze MediaPipe size until sRef is ready.
    calibScale = holdScale;
    scale = holdScale;
  } else if (
    faceProfile &&
    faceProfile.faceWidthMm > 0 &&
    faceProfile.refEyeSpanScene > 0
  ) {
    calibScale = mediapipeCalibBaseScale(frameWidthMm, faceProfile);
    scale = calibScale;
  }

  const eyeLift = scale * 0.1;
  const position = new Vector3(
    x * aspect,
    y + eyeLift - scale * yOffsetFrac,
    0.2,
  );

  return {
    hasFace: true,
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: _q.x, y: _q.y, z: _q.z, w: _q.w },
    scale,
    liveScale,
    calibScale,
    videoWidth,
    videoHeight,
  };
}
