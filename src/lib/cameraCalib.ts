import { Matrix4, Vector3 } from "three";
import { CANONICAL_CM } from "@/lib/canonicalFace";
import { decomposeHeadMatrix } from "@/lib/headAnchors";
import { IRIS_DIAMETER_MM, LM } from "@/lib/mediapipe/constants";
import type { FaceProfile } from "@/lib/faceProfile";
import type { LandmarkPoint } from "@/store/tryOnStore";

/**
 * Camera calibration state consumed by the render camera, fitPose, and the
 * occluder from ONE source (the store).
 */
export type CameraCalib = {
  /** Vertical FOV (deg) the metric pose is projected with. */
  fovDeg: number;
  /** Iris-calibrated relative scale correction (1 = uncalibrated). */
  scaleCorrection: number;
  /** Reprojection rms of the last focal self-check (null = never ran). */
  rms: number | null;
};

export const DEFAULT_CAMERA_CALIB: CameraCalib = {
  fovDeg: 63,
  scaleCorrection: 1,
  rms: null,
};

export const CAMERA_CALIB_STORAGE_KEY = "eyenetra:cameraCalib";

export function loadCameraCalib(): CameraCalib | null {
  try {
    const raw = localStorage.getItem(CAMERA_CALIB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CameraCalib>;
    if (
      !Number.isFinite(parsed.fovDeg) ||
      parsed.fovDeg! < 30 ||
      parsed.fovDeg! > 120 ||
      !Number.isFinite(parsed.scaleCorrection) ||
      parsed.scaleCorrection! < 0.7 ||
      parsed.scaleCorrection! > 1.4
    ) {
      return null;
    }
    return {
      fovDeg: parsed.fovDeg!,
      scaleCorrection: parsed.scaleCorrection!,
      rms: Number.isFinite(parsed.rms) ? (parsed.rms as number) : null,
    };
  } catch {
    return null;
  }
}

export function saveCameraCalib(calib: CameraCalib): void {
  try {
    localStorage.setItem(CAMERA_CALIB_STORAGE_KEY, JSON.stringify(calib));
  } catch {
    // Storage unavailable (private mode) — session-only calibration.
  }
}

const _m = new Matrix4();
const _p = new Vector3();

/**
 * Least-squares fit of the vertical FOV that MediaPipe's face-geometry solver
 * implicitly used: project the matrix-posed canonical vertices and match the
 * observed image landmarks. The y-axis equation is mirror-free, so the focal
 * is solved from y only; x (with the better of both mirror signs) joins the
 * rms self-check.
 *
 * v - 0.5 = -k · P.y / (-P.z)   with   k = 1 / (2·tanHalfFovV)
 */
export function estimateFocalFit(
  landmarks: LandmarkPoint[],
  transformMatrix: number[] | null,
  aspect: number,
): { fovDeg: number; rms: number } | null {
  if (!decomposeHeadMatrix(transformMatrix, _m)) return null;
  if (!landmarks || landmarks.length < 468 || aspect <= 0) return null;

  let num = 0;
  let den = 0;
  const rows: { ax: number; bx: number; ay: number; by: number }[] = [];
  for (const key of Object.keys(CANONICAL_CM)) {
    const idx = Number(key);
    const lm = landmarks[idx];
    if (!lm) continue;
    const c = CANONICAL_CM[idx];
    _p.set(c[0], c[1], c[2]).applyMatrix4(_m);
    const dz = -_p.z;
    if (!(dz > 1)) return null;
    const ay = -_p.y / dz;
    const by = lm.y - 0.5;
    const ax = _p.x / (dz * aspect);
    const bx = lm.x - 0.5;
    rows.push({ ax, bx, ay, by });
    num += ay * by;
    den += ay * ay;
  }
  if (den < 1e-9 || rows.length < 6) return null;
  const k = num / den;
  if (!(k > 0.1) || !(k < 5)) return null;

  // rms over both axes; x tries both mirror signs (video mirroring).
  let ssPos = 0;
  let ssNeg = 0;
  let ssY = 0;
  for (const r of rows) {
    const ey = r.by - k * r.ay;
    ssY += ey * ey;
    const ep = r.bx - k * r.ax;
    const en = r.bx + k * r.ax;
    ssPos += ep * ep;
    ssNeg += en * en;
  }
  const n = rows.length;
  const rms = Math.sqrt((ssY + Math.min(ssPos, ssNeg)) / (2 * n));
  const fovDeg = (2 * Math.atan(1 / (2 * k)) * 180) / Math.PI;
  return { fovDeg, rms };
}

/**
 * Iris-calibrated relative scale correction. Back-project the outer canthi at
 * the matrix depth under the solver FOV → canthal width in matrix-space cm.
 * correction = sceneWidthMm / trueWidthMm. Any solver-vs-real FOV error
 * cancels where it matters: rendered glasses width RELATIVE to the face.
 */
export function computeScaleCorrection(
  landmarks: LandmarkPoint[],
  transformMatrix: number[] | null,
  aspect: number,
  fovDeg: number,
  faceProfile: FaceProfile | null,
): number {
  if (
    !faceProfile ||
    !Number.isFinite(faceProfile.faceWidthMm) ||
    faceProfile.faceWidthMm < 20 ||
    faceProfile.faceWidthMm > 250
  ) {
    return 1;
  }
  if (!decomposeHeadMatrix(transformMatrix, _m)) return 1;
  const l = landmarks?.[LM.LEFT_EYE_OUTER];
  const r = landmarks?.[LM.RIGHT_EYE_OUTER];
  if (!l || !r || aspect <= 0) return 1;
  // Canthi depth = transformed canonical canthus (face front, not head origin).
  const c33 = CANONICAL_CM[33];
  const depth = -_p.set(c33[0], c33[1], c33[2]).applyMatrix4(_m).z;
  if (!(depth > 5)) return 1;
  const tanHalf = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  // Normalized image delta → camera-space cm at `depth` (pinhole).
  const dxCm = (l.x - r.x) * 2 * depth * tanHalf * aspect;
  const dyCm = (l.y - r.y) * 2 * depth * tanHalf;
  const sceneWidthMm = Math.hypot(dxCm, dyCm) * 10;
  const correction = sceneWidthMm / faceProfile.faceWidthMm;
  return Math.min(1.4, Math.max(0.7, correction));
}

/**
 * Debug-only cross-check: head depth from the iris diameter (11.7 mm ruler)
 * vs the matrix depth. Ratio far from 1 flags a solver/real FOV mismatch.
 */
export function depthCrossCheck(
  irisDiamNorm: number,
  matrixDepthCm: number,
  fovDeg: number,
): number | null {
  if (!(irisDiamNorm > 1e-5) || !(matrixDepthCm > 1)) return null;
  const tanHalf = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  // Normalized-height units: f_norm = 1 / (2·tanHalf).
  const irisDepthCm = (IRIS_DIAMETER_MM / 10 / (2 * tanHalf)) / irisDiamNorm;
  return irisDepthCm / matrixDepthCm;
}
