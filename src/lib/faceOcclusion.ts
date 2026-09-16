import { Matrix4, Vector3 } from "three";
import type { LandmarkPoint } from "@/store/tryOnStore";
import { LM } from "@/lib/mediapipe/constants";
import { PERSPECTIVE_FOV_DEG } from "@/lib/fitPose";

const VERTICES = 468;
const CLEARANCE_CM = 1.6;

/** Reconstruct a conservative face surface in the raw glasses anchor space.
 * Per-frame hot path: caller owns buffers and scratch vector; no allocations.
 * Z is an estimated relative depth, not a measured facial scan.
 */
export function writeFaceSurface(
  landmarks: LandmarkPoint[], depth: number, aspect: number,
  inverseAnchor: Matrix4, positions: Float32Array, scratch: Vector3,
): boolean {
  const mid = landmarks[LM.MID_EYES];
  if (!mid || landmarks.length < VERTICES || positions.length < VERTICES * 3 ||
      !Number.isFinite(depth) || depth <= 1 || !Number.isFinite(aspect) || aspect <= 0)
    return false;
  const tanHalf = Math.tan(PERSPECTIVE_FOV_DEG * Math.PI / 360);
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
  for (let i = 0; i < VERTICES; i++) {
    const x = positions[i * 3] - centerX;
    const weight = Math.min(1, Math.max(0, (Math.abs(x) / width - 0.25) / 0.2));
    positions[i * 3] -= Math.sign(x) * width * 0.06 * weight;
  }
  return true;
}

/** Posterior head approximation; dimensions follow face measurements, not SKU width. */
export function setPosteriorCap(positions: Float32Array, position: Vector3, scale: Vector3): void {
  const l = 234 * 3, r = 454 * 3;
  const width = Math.abs(positions[l] - positions[r]);
  position.set((positions[l] + positions[r]) / 2, (positions[l+1] + positions[r+1]) / 2,
    Math.min(positions[l+2], positions[r+2]) - width * 0.5);
  scale.set(width * 0.56, width * 0.72, width * 0.48);
}
