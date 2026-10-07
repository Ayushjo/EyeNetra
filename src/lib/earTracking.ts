import { Matrix3, Matrix4, Vector3 } from "three";

/**
 * Per-user ear-junction tracking (MediaPipe vertices 234 / 454, the
 * cheek–ear junction the tragion estimate hangs off).
 *
 * One frame observes a landmark only as a RAY from the camera: its position
 * across the ray is known, its depth along it is not. Seen frontally the rays
 * are parallel to the head's z axis, so the ear's front–back position (the
 * least certain part of the temple target) is unobservable; when the head
 * turns, that side's rays are oblique and constrain it. So instead of
 * averaging per-frame back-projections (which ride on MediaPipe's weak
 * landmark z), accumulate rays in HEAD-LOCAL space and solve the point
 * closest to all of them, with a weak prior toward the canonical position:
 *
 *   P = argmin Σ |(I − uᵢuᵢᵀ)(P − qᵢ)|² + λ·N·|P − prior|²
 *     → (Σ(I − uᵢuᵢᵀ) + λN·I) P = Σ(I − uᵢuᵢᵀ) qᵢ + λN·prior
 *
 * (qᵢ = camera centre in head space, uᵢ = unit ray direction in head space).
 * Directions no ray constrains fall back to the prior instead of drifting.
 */

export type EarRay = { q: Vector3; u: Vector3 };

const _inv = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();

/**
 * Head-local ray through landmark `lm` (normalized image coords), or null.
 * `head` maps head-local cm → unmirrored camera space (decomposeHeadMatrix).
 */
export function earRay(
  lm: { x: number; y: number } | undefined,
  head: Matrix4,
  aspect: number,
  tanHalf: number,
): EarRay | null {
  if (!lm || !Number.isFinite(lm.x + lm.y) || !(aspect > 0) || !(tanHalf > 0)) return null;
  _inv.copy(head).invert();
  // Camera centre and a point 100 cm along the pixel ray (unmirrored pinhole).
  _a.set(0, 0, 0).applyMatrix4(_inv);
  _b.set((lm.x - 0.5) * 2 * tanHalf * aspect * 100, (0.5 - lm.y) * 2 * tanHalf * 100, -100)
    .applyMatrix4(_inv);
  const u = _b.clone().sub(_a).normalize();
  if (!Number.isFinite(u.x + u.y + u.z)) return null;
  return { q: _a.clone(), u };
}

/**
 * Whether a side's landmark is visible enough to trust: the camera (in head
 * space) must not be on the opposite side of the head by more than ~10°.
 * side −1 = head −x (vertex 234), +1 = head +x (vertex 454).
 */
export function sideVisible(ray: EarRay, side: -1 | 1): boolean {
  const q = ray.q;
  const len = Math.hypot(q.x, q.z);
  if (!(len > 1)) return false;
  return (side * q.x) / len > -0.17;
}

/** Least-squares ray intersection with a prior; see module doc. */
export function triangulateWithPrior(rays: EarRay[], prior: Vector3, lambda = 0.05): Vector3 {
  const A = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const b = new Vector3();
  const e = A.elements;
  for (const { q, u } of rays) {
    // M = I − uuᵀ (column-major elements; symmetric so order is moot).
    const m = [
      1 - u.x * u.x, -u.x * u.y, -u.x * u.z,
      -u.y * u.x, 1 - u.y * u.y, -u.y * u.z,
      -u.z * u.x, -u.z * u.y, 1 - u.z * u.z,
    ];
    for (let i = 0; i < 9; i++) e[i] += m[i];
    b.x += m[0] * q.x + m[3] * q.y + m[6] * q.z;
    b.y += m[1] * q.x + m[4] * q.y + m[7] * q.z;
    b.z += m[2] * q.x + m[5] * q.y + m[8] * q.z;
  }
  const w = lambda * Math.max(1, rays.length);
  e[0] += w;
  e[4] += w;
  e[8] += w;
  b.addScaledVector(prior, w);
  const inv = A.clone().invert();
  const p = b.applyMatrix3(inv);
  return Number.isFinite(p.x + p.y + p.z) ? p : prior.clone();
}
