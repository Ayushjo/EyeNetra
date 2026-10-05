import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import {
  CANONICAL_CM,
  CANONICAL_LENS_FIT,
  LENS_CENTER_BELOW_PUPIL_CM,
  canonicalTragion,
} from "@/lib/canonicalFace";

const CANONICAL_234 = CANONICAL_CM[234];
const CANONICAL_454 = CANONICAL_CM[454];

/**
 * Anatomical anchor points in the facialTransformationMatrix's head-local
 * metric frame (cm). "canonical" = from the vendored canonical face model;
 * "calibrated" = refined from the user's own back-projected landmarks.
 */
export type HeadAnchors = {
  /**
   * Anatomical sellion in head space. Drives the glasses DEPTH (and the
   * pantoscopic solve). Its X/Y are NOT re-applied at pose time: the
   * per-frame image ray through the observed 168→6 landmarks already encodes
   * the user's seat X/Y, and this point was itself measured from those
   * landmarks during calibration.
   */
  seatHeadCm: Vector3;
  /**
   * Intentional 3D displacement of the glasses from the anatomical seat,
   * in head-local cm (e.g. a user/SKU "sits lower on my nose" trim). Applied
   * fully, rotating with the head — never cancelled by the image lock.
   */
  seatOffsetHeadCm?: Vector3;
  tragionLHeadCm: Vector3;
  tragionRHeadCm: Vector3;
  source: "canonical" | "calibrated";
};

export type TragionTune = { backCm: number; upCm: number };

export const DEFAULT_TRAGION_TUNE: TragionTune = { backCm: 1.2, upCm: 0.2 };

export function canonicalHeadAnchors(tune?: TragionTune): HeadAnchors {
  return {
    seatHeadCm: CANONICAL_LENS_FIT.clone(),
    tragionLHeadCm: canonicalTragion("L", tune),
    tragionRHeadCm: canonicalTragion("R", tune),
    source: "canonical",
  };
}

export const HEAD_ANCHORS_STORAGE_KEY = "eyenetra:headAnchors:v1";

/** Only measured anchors are persisted; canonical anchors are always rebuilt. */
export function saveHeadAnchors(anchors: HeadAnchors): void {
  if (anchors.source !== "calibrated" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(HEAD_ANCHORS_STORAGE_KEY, JSON.stringify({
      version: 1,
      seat: anchors.seatHeadCm.toArray(),
      left: anchors.tragionLHeadCm.toArray(),
      right: anchors.tragionRHeadCm.toArray(),
    }));
  } catch {
    // Storage unavailable: keep this session's calibration.
  }
}

export function loadHeadAnchors(): HeadAnchors | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(HEAD_ANCHORS_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const vector = (value: unknown): Vector3 | null =>
      Array.isArray(value) && value.length === 3 &&
      value.every((n) => typeof n === "number" && Number.isFinite(n))
        ? new Vector3(value[0], value[1], value[2])
        : null;
    const seat = vector(data.seat);
    const left = vector(data.left);
    const right = vector(data.right);
    const canonical = canonicalHeadAnchors();
    if (
      data.version !== 1 || !seat || !left || !right ||
      seat.distanceTo(canonical.seatHeadCm) > 3 ||
      left.distanceTo(canonical.tragionLHeadCm) > 3 ||
      right.distanceTo(canonical.tragionRHeadCm) > 3
    ) return null;
    return { seatHeadCm: seat, tragionLHeadCm: left, tragionRHeadCm: right, source: "calibrated" };
  } catch {
    return null;
  }
}

export function clearHeadAnchors(): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(HEAD_ANCHORS_STORAGE_KEY); } catch {}
}

const _pos = new Vector3();
const _quat = new Quaternion();
const _scl = new Vector3();
const _frontalMatrix = new Matrix4();
const _frontalEuler = new Euler();

/**
 * Load MediaPipe's facialTransformationMatrix into `out` as a three.js
 * (column-major) matrix. Data is row-major → transpose; some builds already
 * deliver column-major, detected by a zero translation after transpose.
 * Returns false when the matrix is unusable.
 */
export function decomposeHeadMatrix(
  transformMatrix: number[] | null,
  out: Matrix4,
): boolean {
  if (!transformMatrix || transformMatrix.length < 16) return false;
  out.fromArray(transformMatrix).transpose();
  out.decompose(_pos, _quat, _scl);
  if (_pos.lengthSq() < 1e-10) {
    out.fromArray(transformMatrix);
    out.decompose(_pos, _quat, _scl);
    if (_pos.lengthSq() < 1e-10) {
      // Rotation-only matrix (synthetic fixtures / degenerate frames):
      // keep the transposed layout; callers fall back to a default depth.
      out.fromArray(transformMatrix).transpose();
    }
  }
  return true;
}

/** Calibration must be near frontal; yawed eye/iris distances are foreshortened. */
export function isFrontalHeadPose(transformMatrix: number[] | null): boolean {
  if (!decomposeHeadMatrix(transformMatrix, _frontalMatrix)) return false;
  _frontalMatrix.decompose(_pos, _quat, _scl);
  _frontalEuler.setFromQuaternion(_quat, "YXZ");
  return (
    Math.abs(_frontalEuler.y) <= (12 * Math.PI) / 180 &&
    Math.abs(_frontalEuler.x) <= (12 * Math.PI) / 180 &&
    Math.abs(_frontalEuler.z) <= (10 * Math.PI) / 180
  );
}

/** Glasses geometry scanned from the normalized GLB (width = 1 unit). */
export type GlassesGeom = {
  /** Bridge/nose-pad contact in normalized model units (origin after re-pivot → ~0). */
  bridgeLocal: { x: number; y: number; z: number };
  /** Mean hinge point (one side, +x) in normalized model units. */
  hingeLocal: { x: number; y: number; z: number };
};

export type PantoscopicInput = {
  anchors: HeadAnchors;
  glassesGeom: GlassesGeom | null;
  frameWidthMm: number;
  templeLengthMm: number;
};

export const MAX_PANTOSCOPIC_RAD = (15 * Math.PI) / 180;
/** Temples rest slightly above the tragus. */
export const EAR_REST_UP_CM = 0.4;

const _hinge = new Vector3();
const _dir = new Vector3();
const _ear = new Vector3();

/**
 * Solve the pitch (about the glasses' local X axis, applied at the seat
 * anchor) that makes the temple line from the hinge pass through the ear
 * rest point. All inputs are head-local constants, so this runs only when
 * SKU / anchors / tune change — never per frame.
 *
 * Sign: rotation about +X by α moves the temple tip up (three.js RH rule
 * with temples along -Z). Ears sit below the hinge line for most faces, so
 * α is typically negative (temples slope down, i.e. pantoscopic tilt).
 */
export function solvePantoscopicPitch(input: PantoscopicInput): number {
  const { anchors, glassesGeom, frameWidthMm, templeLengthMm } = input;
  if (!glassesGeom) return 0;
  const widthCm = frameWidthMm / 10;
  void templeLengthMm; // direction-only solve; length kept for future splay work

  let alpha = 0;
  // Two fixed iterations: the hinge orbits the seat as alpha changes.
  for (let iter = 0; iter < 2; iter++) {
    let sum = 0;
    for (const side of [-1, 1] as const) {
      _hinge.set(
        side * Math.abs(glassesGeom.hingeLocal.x) * widthCm,
        glassesGeom.hingeLocal.y * widthCm,
        glassesGeom.hingeLocal.z * widthCm,
      );
      // Rotate hinge offset about X by current alpha, then place at seat.
      const cos = Math.cos(alpha);
      const sin = Math.sin(alpha);
      const hy = _hinge.y * cos - _hinge.z * sin;
      const hz = _hinge.y * sin + _hinge.z * cos;
      _hinge.set(_hinge.x, hy, hz).add(anchors.seatHeadCm);

      _ear
        .copy(side < 0 ? anchors.tragionLHeadCm : anchors.tragionRHeadCm)
        .setY(
          (side < 0 ? anchors.tragionLHeadCm : anchors.tragionRHeadCm).y +
            EAR_REST_UP_CM,
        );
      _dir.subVectors(_ear, _hinge);
      // Temple points along -Z pre-rotation; required pitch so it aims at ear.
      sum += Math.atan2(_dir.y, -_dir.z);
    }
    alpha = sum / 2;
  }
  return Math.max(-MAX_PANTOSCOPIC_RAD, Math.min(MAX_PANTOSCOPIC_RAD, alpha));
}

export type AnchorSample = {
  landmarks: { x: number; y: number; z: number }[];
  transformMatrix: number[] | null;
};

const REFINE_INDICES = [168, 6, 33, 133, 362, 263, 234, 454] as const;
const _rm = new Matrix4();
const _rinv = new Matrix4();
const _rp = new Vector3();

/**
 * Refine the canonical anchors from the user's own face: back-project the key
 * landmarks at per-landmark metric depth (unmirrored camera space), map them
 * into the head-local frame with the inverse transform matrix, and average
 * over the calibration burst.
 *
 * Seat: measured 168→6 lerp (z blended 50/50 with canonical — landmark z is
 * the least reliable axis). Tragions: canonical estimate shifted by the
 * measured-vs-canonical delta of vertices 234/454 (x/y only).
 */
export function refineHeadAnchors(
  samples: AnchorSample[],
  aspect: number,
  fovDeg: number,
  base: HeadAnchors,
): HeadAnchors | null {
  if (!samples.length || !(aspect > 0)) return null;
  const tanHalf = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const sums = new Map<number, Vector3>();
  for (const idx of REFINE_INDICES) sums.set(idx, new Vector3());
  let kept = 0;

  const c168 = CANONICAL_CM[168];
  for (const s of samples) {
    if (!decomposeHeadMatrix(s.transformMatrix, _rm)) continue;
    _rm.decompose(_pos, _quat, _scl);
    const headDepth = Math.abs(_pos.z);
    if (!(headDepth > 5)) continue;
    const mid = s.landmarks[168];
    if (!mid) continue;
    _rinv.copy(_rm).invert();
    // Anchor the relative landmark depths at landmark 168's TRUE camera
    // depth (the transformed canonical vertex), not the head origin — the
    // face front sits ~5 cm closer to the camera than the head pivot.
    const midDepth = -_rp.set(c168[0], c168[1], c168[2]).applyMatrix4(_rm).z;
    if (!(midDepth > 5)) continue;
    const depthScale = 2 * midDepth * tanHalf * aspect;
    let ok = true;
    const framePoints: Vector3[] = [];
    for (const idx of REFINE_INDICES) {
      const lm = s.landmarks[idx];
      if (!lm || !Number.isFinite(lm.x + lm.y + lm.z)) {
        ok = false;
        break;
      }
      const d = midDepth + (lm.z - mid.z) * depthScale;
      if (!(d > 1)) {
        ok = false;
        break;
      }
      // Unmirrored pinhole back-projection (camera space, +X image-right).
      _rp
        .set(
          (lm.x - 0.5) * 2 * d * tanHalf * aspect,
          -(lm.y - 0.5) * 2 * d * tanHalf,
          -d,
        )
        .applyMatrix4(_rinv);
      framePoints.push(_rp.clone());
    }
    if (ok) {
      REFINE_INDICES.forEach((idx, i) => sums.get(idx)!.add(framePoints[i]));
      kept++;
    }
  }
  if (kept < 5) return null;
  for (const v of sums.values()) v.divideScalar(kept);

  // Lens-fit point: x/y on the measured pupil line (canthi mean) minus the
  // pupil-above-lens-centre drop; z from the measured sellion (168→6 lerp).
  const canthi = [33, 133, 362, 263].map((i) => sums.get(i)!);
  const sellion = sums.get(168)!.clone().lerp(sums.get(6)!, 0.6);
  const measuredSeat = new Vector3(
    canthi.reduce((a, c) => a + c.x, 0) / 4,
    canthi.reduce((a, c) => a + c.y, 0) / 4 - LENS_CENTER_BELOW_PUPIL_CM,
    sellion.z,
  );
  // Landmark-derived z rides on MediaPipe's weak relative depth — trust it
  // only halfway against the canonical shape.
  measuredSeat.z = measuredSeat.z * 0.5 + base.seatHeadCm.z * 0.5;

  // Sanity: a seat several cm off canonical means the back-projection broke.
  if (measuredSeat.distanceTo(base.seatHeadCm) > 3) return null;

  const dL = sums.get(234)!.clone().sub(new Vector3(...(CANONICAL_234 as [number, number, number])));
  const dR = sums.get(454)!.clone().sub(new Vector3(...(CANONICAL_454 as [number, number, number])));

  const clampCm = (v: Vector3) => {
    v.x = Math.max(-1.5, Math.min(1.5, v.x));
    v.y = Math.max(-1.5, Math.min(1.5, v.y));
    v.z = 0; // z shift untrusted
    return v;
  };

  return {
    seatHeadCm: measuredSeat,
    tragionLHeadCm: base.tragionLHeadCm.clone().add(clampCm(dL)),
    tragionRHeadCm: base.tragionRHeadCm.clone().add(clampCm(dR)),
    source: "calibrated",
  };
}

let _pantoCacheKey: string | null = null;
let _pantoCacheAnchors: HeadAnchors | null = null;
let _pantoCacheGeom: GlassesGeom | null = null;
let _pantoCacheVal = 0;

/**
 * Per-frame-safe memo: the solve only depends on the SKU geometry and the
 * head anchors, both of which change rarely (SKU switch, calibration, tune).
 */
export function cachedPantoRad(
  anchors: HeadAnchors,
  geom: GlassesGeom | null,
  frameId: string,
  frameWidthMm: number,
  templeLengthMm: number,
): number {
  if (
    _pantoCacheKey === frameId &&
    _pantoCacheAnchors === anchors &&
    _pantoCacheGeom === geom
  ) {
    return _pantoCacheVal;
  }
  _pantoCacheKey = frameId;
  _pantoCacheAnchors = anchors;
  _pantoCacheGeom = geom;
  _pantoCacheVal = solvePantoscopicPitch({
    anchors,
    glassesGeom: geom,
    frameWidthMm,
    templeLengthMm,
  });
  return _pantoCacheVal;
}

export function pantoscopicQuaternion(alphaRad: number): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), alphaRad);
}
