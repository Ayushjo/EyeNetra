import { Matrix4, Vector3 } from "three";
import type { LandmarkPoint } from "@/store/tryOnStore";
import { LM } from "@/lib/mediapipe/constants";
import { PERSPECTIVE_FOV_DEG } from "@/lib/fitPose";
import { CANONICAL_MESH_CM } from "@/lib/canonicalFaceMesh";

const VERTICES = 468;
const CLEARANCE_CM = 1.6;

/** Reconstruct a conservative face surface in the raw glasses anchor space.
 * Per-frame hot path: caller owns buffers and scratch vector; no allocations.
 * Z is an estimated relative depth, not a measured facial scan.
 */
export function writeFaceSurface(
  landmarks: LandmarkPoint[], depth: number, aspect: number,
  inverseAnchor: Matrix4, positions: Float32Array, scratch: Vector3,
  tanHalf: number = Math.tan(PERSPECTIVE_FOV_DEG * Math.PI / 360),
): boolean {
  const mid = landmarks[LM.MID_EYES];
  if (!mid || landmarks.length < VERTICES || positions.length < VERTICES * 3 ||
      !Number.isFinite(depth) || depth <= 1 || !Number.isFinite(aspect) || aspect <= 0)
    return false;
  // MediaPipe normalized Z is scaled like image X (image-width units).
  const depthScale = 2 * depth * tanHalf * aspect;
  for (let i = 0; i < VERTICES; i++) {
    const lm = landmarks[i];
    if (!lm || !Number.isFinite(lm.x + lm.y + lm.z)) return false;
    const distance = depth + (lm.z - mid.z) * depthScale + CLEARANCE_CM;
    if (distance <= 1 || !Number.isFinite(distance)) return false;
    scratch.set((0.5 - lm.x) * 2 * distance * tanHalf * aspect,
      (0.5 - lm.y) * 2 * distance * tanHalf, -distance).applyMatrix4(inverseAnchor);
    scratch.toArray(positions, i * 3);
  }
  const left = 234 * 3, right = 454 * 3;
  const centerX = (positions[left] + positions[right]) / 2;
  const width = Math.abs(positions[left] - positions[right]);
  if (!(width > 0.01)) return false;
  // Lateral depth is uncertain. Inset the mask (not the product) toward the
  // skull center so an estimated cheek cannot slice through the near temple.
  // (3% now that dedicated ear proxies cover the temple-to-ear region.)
  for (let i = 0; i < VERTICES; i++) {
    const x = positions[i * 3] - centerX;
    const weight = Math.min(1, Math.max(0, (Math.abs(x) / width - 0.25) / 0.2));
    positions[i * 3] -= Math.sign(x) * width * 0.03 * weight;
  }
  return true;
}

/** Skin clearance for the metric surface (cm): keeps the mask just behind the
 * true skin so the frame's own back faces are never eaten by z-fighting. */
export const METRIC_CLEARANCE_CM = 0.3;
/** Lateral inset as a fraction of face width (mask only, not the product):
 * the temples run flush against the side of the head, so a mask exactly on
 * the skin would hide the near temple at any yaw. */
export const METRIC_LATERAL_INSET = 0.03;

const _c = new Vector3();

/**
 * Metric face surface: per vertex, DEPTH from the head-posed canonical
 * vertex (the matrix is a least-squares fit of this very mesh to the observed
 * landmarks — ~7 px reprojection rms in practice) and IMAGE X/Y from the
 * observed landmark, so the mask hugs the real silhouette with metric depth.
 * This replaces MediaPipe's weak relative landmark-z, which needed a 1.6 cm
 * push-back and let the nose fail to occlude the far lens at yaw.
 *
 * Per-frame hot path: no allocations beyond the caller's buffers.
 */
export function writeFaceSurfaceMetric(
  landmarks: LandmarkPoint[], headMatrix: Matrix4, aspect: number, tanHalf: number,
  inverseAnchor: Matrix4, positions: Float32Array, scratch: Vector3,
  clearanceCm: number = METRIC_CLEARANCE_CM,
): boolean {
  if (landmarks.length < VERTICES || positions.length < VERTICES * 3 ||
      !Number.isFinite(aspect) || aspect <= 0 || !(tanHalf > 0))
    return false;
  for (let i = 0; i < VERTICES; i++) {
    const lm = landmarks[i];
    if (!lm || !Number.isFinite(lm.x + lm.y)) return false;
    _c.fromArray(CANONICAL_MESH_CM, i * 3).applyMatrix4(headMatrix);
    const distance = -_c.z + clearanceCm;
    if (!(distance > 1)) return false;
    scratch.set((0.5 - lm.x) * 2 * distance * tanHalf * aspect,
      (0.5 - lm.y) * 2 * distance * tanHalf, -distance).applyMatrix4(inverseAnchor);
    scratch.toArray(positions, i * 3);
  }
  const left = 234 * 3, right = 454 * 3;
  const centerX = (positions[left] + positions[right]) / 2;
  const width = Math.abs(positions[left] - positions[right]);
  if (!(width > 0.01)) return false;
  for (let i = 0; i < VERTICES; i++) {
    const x = positions[i * 3] - centerX;
    const weight = Math.min(1, Math.max(0, (Math.abs(x) / width - 0.25) / 0.2));
    positions[i * 3] -= Math.sign(x) * width * METRIC_LATERAL_INSET * weight;
  }
  return true;
}

/**
 * Depth-only ear/side-head proxy at the cheek-ear junction vertex (234 left,
 * 454 right), pushed back toward the tragus and sized from the face width.
 * Works in the same anchor-local space as the mask (positions buffer), so no
 * extra matrix work. MediaPipe has no ear geometry — this is an estimate.
 */
export function setEarProxy(
  positions: Float32Array,
  side: "L" | "R",
  position: Vector3,
  scale: Vector3,
): void {
  const l = 234 * 3, r = 454 * 3;
  const width = Math.abs(positions[l] - positions[r]);
  const i = side === "L" ? l : r;
  const outward = Math.sign(positions[i] - (positions[l] + positions[r]) / 2);
  position.set(
    positions[i] + outward * width * 0.06,
    positions[i + 1] - width * 0.02,
    positions[i + 2] - width * 0.25,
  );
  scale.set(width * 0.15, width * 0.21, width * 0.16);
}

/** Posterior head approximation; dimensions follow face measurements, not SKU width. */
export function setPosteriorCap(positions: Float32Array, position: Vector3, scale: Vector3): void {
  const l = 234 * 3, r = 454 * 3;
  const width = Math.abs(positions[l] - positions[r]);
  position.set((positions[l] + positions[r]) / 2, (positions[l+1] + positions[r+1]) / 2,
    Math.min(positions[l+2], positions[r+2]) - width * 0.5);
  scale.set(width * 0.56, width * 0.72, width * 0.48);
}
