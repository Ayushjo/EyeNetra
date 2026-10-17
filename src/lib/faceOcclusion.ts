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
/**
 * Rigid occluder: the whole canonical face mesh through the head matrix —
 * the same transform that places the glasses (POSE_LOCKED_PLACEMENT). Meta's
 * try-on uses a static canonical face mesh moved by the pose for exactly this
 * reason: landmark-driven surfaces drift relative to pose-placed glasses and
 * cut the lens near the nose. Points are pushed back along their view ray by
 * `clearanceCm`, mirrored for the selfie view, then put in anchor space.
 */
export function writeFaceSurfaceRigid(
  headMatrix: Matrix4, inverseAnchor: Matrix4, positions: Float32Array, scratch: Vector3,
  clearanceCm: number = METRIC_CLEARANCE_CM,
): boolean {
  if (positions.length < VERTICES * 3) return false;
  for (let i = 0; i < VERTICES; i++) {
    _c.fromArray(CANONICAL_MESH_CM, i * 3).applyMatrix4(headMatrix);
    const d = _c.length();
    if (!(d > 1) || !(_c.z < 0)) return false;
    _c.multiplyScalar((d + clearanceCm) / d);
    scratch.set(-_c.x, _c.y, _c.z).applyMatrix4(inverseAnchor);
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

/**
 * Head (skull) proxy ellipsoid in HEAD-LOCAL cm, fitted to the user's tragion
 * anchors (tracked per user, see useEarTracking). Covers the back and top of
 * the head that MediaPipe's face-only mesh lacks (WebAR.rocks ships a head
 * occluder for this; MediaPipe's own face_effect occludes with the face only).
 *
 *  - Front at tragion z + 6 cm: behind the eye corners (z ≈ 3.2) so the face
 *    and nose stay the face mesh's job and nose pads are never clipped.
 *  - Back at tragion z − 10 cm: ~19 cm glabella-to-back head length.
 *  - Top 13 cm above the tragion; half-width 5 mm inside the ear points so a
 *    temple resting at the ear stays in front of it on the near side.
 */
export const SKULL = { frontCm: 6, backCm: 10, upCm: 13, downCm: 8, insetCm: 0.5 } as const;
export function skullEllipsoidHeadCm(tragionL: Vector3, tragionR: Vector3): {
  center: Vector3;
  radii: Vector3;
} {
  const ty = (tragionL.y + tragionR.y) / 2;
  const tz = (tragionL.z + tragionR.z) / 2;
  const halfW = Math.max(3, Math.min(Math.abs(tragionL.x), Math.abs(tragionR.x)) - SKULL.insetCm);
  const zFront = tz + SKULL.frontCm, zBack = tz - SKULL.backCm;
  const yTop = ty + SKULL.upCm, yBottom = ty - SKULL.downCm;
  return {
    center: new Vector3((tragionL.x + tragionR.x) / 2, (yTop + yBottom) / 2, (zFront + zBack) / 2),
    radii: new Vector3(halfW, (yTop - yBottom) / 2, (zFront - zBack) / 2),
  };
}

const _flip = new Matrix4().makeScale(-1, 1, 1);
const _sk = new Matrix4();
/**
 * Matrix placing a unit sphere as the skull proxy in anchor-local space:
 * inverseAnchor · mirror · headMatrix · T(center) · S(radii). Mirroring flips
 * winding; occluder materials are double-sided.
 */
export function skullProxyMatrix(
  tragionL: Vector3, tragionR: Vector3, headMatrix: Matrix4, inverseAnchor: Matrix4, out: Matrix4,
): Matrix4 {
  const { center, radii } = skullEllipsoidHeadCm(tragionL, tragionR);
  _sk.makeScale(radii.x, radii.y, radii.z).setPosition(center);
  return out.copy(inverseAnchor).multiply(_flip).multiply(headMatrix).multiply(_sk);
}

/** MediaPipe face-oval contour (canonical mesh indices, closed loop). */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;

/** Head loft shape (head-local cm). */
export const HEAD_LOFT = { rings: 8, backZ: -14, backShrink: 0.38 } as const;

/**
 * Our own sculpted head occluder (Meta ships a head-occluder model for this;
 * we do not copy it). The canonical face-oval contour is lofted backwards to
 * a rounded back of the head, so it meets the face mask exactly at its edge
 * and fills sides, top and back behind it. Cross-sections only SHRINK going
 * back, so the head is never wider than the face mask's own outline and a
 * temple resting at the ear stays visible from the near side.
 * Returns positions (head-local cm) and triangle indices; built once.
 */
export function buildHeadLoft(): { positions: Float32Array; indices: number[] } {
  const n = FACE_OVAL.length;
  const oval = FACE_OVAL.map((i) => new Vector3().fromArray(CANONICAL_MESH_CM, i * 3));
  const centre = oval.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / n);
  const R = HEAD_LOFT.rings;
  const pos: number[] = [];
  for (let r = 0; r <= R; r++) {
    const t = r / R;
    const shrink = 1 - HEAD_LOFT.backShrink * t * t;
    for (const p of oval) {
      const x = centre.x + (p.x - centre.x) * shrink;
      const y = centre.y + (p.y - centre.y) * shrink;
      // Ease the depth so the first rings hug the face edge, then sweep back.
      const z = p.z + (HEAD_LOFT.backZ - p.z) * (1 - Math.cos((t * Math.PI) / 2));
      pos.push(x, y, z);
    }
  }
  const backCentre = pos.length / 3;
  pos.push(centre.x, centre.y * (1 - HEAD_LOFT.backShrink), HEAD_LOFT.backZ - 1);
  const idx: number[] = [];
  for (let r = 0; r < R; r++) {
    for (let k = 0; k < n; k++) {
      const a = r * n + k, b = r * n + ((k + 1) % n), c = (r + 1) * n + k, d = (r + 1) * n + ((k + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let k = 0; k < n; k++) idx.push(R * n + k, backCentre, R * n + ((k + 1) % n));
  return { positions: new Float32Array(pos), indices: idx };
}

const _hm = new Matrix4();
/** Anchor-local placement of the head loft: inverseAnchor · mirror · headMatrix. */
export function headLoftMatrix(headMatrix: Matrix4, inverseAnchor: Matrix4, out: Matrix4): Matrix4 {
  _hm.makeScale(-1, 1, 1);
  return out.copy(inverseAnchor).multiply(_hm).multiply(headMatrix);
}
