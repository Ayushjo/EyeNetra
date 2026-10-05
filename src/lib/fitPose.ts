import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { LM } from "@/lib/mediapipe/constants";
import { landmarkToWorld } from "@/lib/coords";
import type { FaceProfile } from "@/lib/faceProfile";
import { decomposeHeadMatrix, type HeadAnchors } from "@/lib/headAnchors";
import { LENS_CENTER_BELOW_PUPIL_CM } from "@/lib/canonicalFace";
import { CANONICAL_CM } from "@/lib/canonicalFace";
import type { LandmarkPoint } from "@/store/tryOnStore";

export type FitPose = {
  position: Vector3;
  quaternion: Quaternion;
  scale: number;
  /** Uncalibrated eye-span scale (for jitter comparison). */
  liveScale: number;
  /** Calibrated scale when faceProfile is present. */
  calibScale: number | null;
};

export type ComputePoseInput = {
  landmarks: LandmarkPoint[];
  transformMatrix: number[] | null;
  aspect: number;
  scaleMul: number;
  yOffsetFrac: number;
  frameWidthMm: number;
  faceProfile: FaceProfile | null;
  modelCorrect?: Quaternion;
  debugLog?: boolean;
};

export { landmarkToWorld } from "@/lib/coords";

const _m = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _scl = new Vector3();
const _euler = new Euler();
const _a = new Vector3();
const _b = new Vector3();
const _mid = new Vector3();
const IDENTITY = new Quaternion();

let lastEulerLogMs = 0;
let loggedRawMatrix = false;

function toVec(lm: LandmarkPoint, aspect: number, out: Vector3): Vector3 {
  const p = landmarkToWorld(lm, aspect);
  return out.set(p.x, p.y, p.z);
}

/** Outer-canthi (or iris) span in scene units — live geometry only. */
export function outerEyeSpanScene(
  landmarks: LandmarkPoint[],
  aspect: number,
): number {
  const leftOuter = landmarks[LM.LEFT_EYE_OUTER];
  const rightOuter = landmarks[LM.RIGHT_EYE_OUTER];
  const leftIris = landmarks[LM.LEFT_IRIS];
  const rightIris = landmarks[LM.RIGHT_IRIS];
  if (leftOuter && rightOuter) {
    toVec(leftOuter, aspect, _a);
    toVec(rightOuter, aspect, _b);
  } else if (leftIris && rightIris) {
    toVec(leftIris, aspect, _a);
    toVec(rightIris, aspect, _b);
  } else {
    return 0.5;
  }
  return Math.max(1e-4, _a.distanceTo(_b));
}

function eyeSpanScale(
  landmarks: LandmarkPoint[],
  aspect: number,
  scaleMul: number,
): number {
  return Math.min(
    2.8,
    Math.max(0.2, outerEyeSpanScene(landmarks, aspect) * scaleMul),
  );
}

/**
 * Live path: eyeSpan * scaleMul (per-frame, heuristic width guess).
 *
 * Calibrated: (frameWidthMm / faceWidthMm) * LIVE eye-span. This is the key
 * fix — the ratio (frame mm ÷ your real face mm) is a constant, but it is
 * multiplied by the *live* outer-canthi span so the frame keeps tracking
 * distance: lean in → span grows → frame grows, lean out → shrinks. The old
 * code froze `refEyeSpanScene` (calibration-time span), which pinned the frame
 * to one size while the face changed with distance — that is why calibrated
 * frames looked too big when leaning back, too small when leaning in, then
 * vanished. So calibration now sets the *correct width ratio* to your real
 * face (mm-accurate) AND still follows distance.
 */
export function resolveSceneScale(
  landmarks: LandmarkPoint[],
  aspect: number,
  scaleMul: number,
  frameWidthMm: number,
  faceProfile: FaceProfile | null,
): { scale: number; liveScale: number; calibScale: number | null } {
  const liveScale = eyeSpanScale(landmarks, aspect, scaleMul);
  // Reject corrupt stored measurements; do not turn an invalid profile into
  // an apparently calibrated, tiny frame. Broad bounds are input guards only.
  if (!faceProfile || !Number.isFinite(faceProfile.faceWidthMm) ||
      faceProfile.faceWidthMm < 20 || faceProfile.faceWidthMm > 250) {
    return { scale: liveScale, liveScale, calibScale: null };
  }
  const liveSpan = outerEyeSpanScene(landmarks, aspect);
  // CALIB_FIT (<1): the GLB's normalized front width includes flared hinges, so
  // nominal frameWidthMm slightly over-scales the visible lens area. Small trim
  // keeps real-world width honest without shrinking below the eye line.
  const CALIB_FIT = 0.94;
  const rawCalib = (frameWidthMm / faceProfile.faceWidthMm) * liveSpan * CALIB_FIT;
  const calibScale = Math.min(2.8, Math.max(0.2, rawCalib));
  return { scale: calibScale, liveScale, calibScale };
}

function loadMpMatrix(data: number[]): Matrix4 {
  return _m.fromArray(data);
}

function mirrorPoseForVideo(pos: Vector3, quat: Quaternion) {
  pos.x *= -1;
  quat.set(quat.x, -quat.y, -quat.z, quat.w);
}

/**
 * Single pure pose function for glasses fit.
 * Rotation from facialTransformationMatrixes; XY from iris/mid-eyes landmarks
 * only (MediaPipe matrix translation is metric camera space — mixing it into
 * ortho overlay units puts frames off-screen, e.g. y≈3.8 with top=1).
 * Scale from resolveSceneScale.
 */
export function computePose(input: ComputePoseInput): FitPose | null {
  const {
    landmarks,
    transformMatrix,
    aspect,
    scaleMul,
    yOffsetFrac,
    frameWidthMm,
    faceProfile,
    modelCorrect = IDENTITY,
    debugLog = false,
  } = input;

  if (!transformMatrix || transformMatrix.length < 16) return null;

  const leftIris = landmarks[LM.LEFT_IRIS];
  const rightIris = landmarks[LM.RIGHT_IRIS];
  if (!leftIris || !rightIris) return null;

  if (debugLog && !loggedRawMatrix) {
    loggedRawMatrix = true;
    console.info(
      "[EyeNetra:pose] raw MP matrix.data (16)=",
      transformMatrix.map((v) => Number(v.toFixed(4))),
    );
  }

  loadMpMatrix(transformMatrix);
  _m.decompose(_pos, _quat, _scl);

  if (_pos.lengthSq() < 1e-10) {
    _m.fromArray(transformMatrix).transpose();
    _m.decompose(_pos, _quat, _scl);
    if (debugLog && _pos.lengthSq() > 1e-10) {
      console.info(
        "[EyeNetra:pose] using TRANSPOSED matrix layout (non-zero translation recovered)",
      );
    }
  }

  // Rotation only from matrix — discard metric translation for overlay XY.
  _quat.multiply(modelCorrect);
  mirrorPoseForVideo(_pos, _quat);

  toVec(leftIris, aspect, _a);
  toVec(rightIris, aspect, _b);
  const irisMid = _a.clone().add(_b).multiplyScalar(0.5);
  const midFace = landmarks[LM.MID_EYES] ?? landmarks[LM.NOSE_BRIDGE];
  if (midFace) {
    toVec(midFace, aspect, _mid);
  } else {
    _mid.copy(irisMid);
  }

  const { scale, liveScale, calibScale } = resolveSceneScale(
    landmarks,
    aspect,
    scaleMul,
    frameWidthMm,
    faceProfile,
  );

  // Ortho overlay: landmark mid only (matches video pixels 1:1).
  const position = _mid.clone();
  position.y -= scale * yOffsetFrac;
  // Stable forward Z so frames don't dive behind the camera plane.
  position.z = 0.12;

  if (debugLog) {
    const now = performance.now();
    if (now - lastEulerLogMs > 400) {
      lastEulerLogMs = now;
      _euler.setFromQuaternion(_quat, "YXZ");
      console.info(
        `[EyeNetra:pose] eulerYXZ° pitch=${((_euler.x * 180) / Math.PI).toFixed(1)} yaw=${((_euler.y * 180) / Math.PI).toFixed(1)} roll=${((_euler.z * 180) / Math.PI).toFixed(1)} pos=(${position.x.toFixed(3)},${position.y.toFixed(3)},${position.z.toFixed(3)})`,
      );
    }
  }

  return {
    position,
    quaternion: _quat.clone(),
    scale,
    liveScale,
    calibScale,
  };
}

/**
 * Vertical FOV (degrees) of the virtual camera. MediaPipe's face-geometry
 * "environment" solves the transformation matrix assuming this perspective, so
 * the R3F PerspectiveCamera MUST match it for the metric pose to project right.
 */
export const PERSPECTIVE_FOV_DEG = 63;

const _mp = new Matrix4();
const _posP = new Vector3();
const _quatP = new Quaternion();
const _sclP = new Vector3();

export type PerspectiveInput = {
  landmarks: LandmarkPoint[];
  transformMatrix: number[] | null;
  aspect: number;
  frameWidthMm: number;
  /** Nose-pad standoff from the frame front (mm) — pushes off the seat. */
  nosePadOffsetMm?: number;
  scaleTune: number;
  /** Residual trims only (default 0) — anatomical seat does the real work. */
  yOffsetCm: number;
  zOffsetCm: number;
  /** Head-local anatomical anchors; null falls back to the mid-eye ray path. */
  headAnchors?: HeadAnchors | null;
  /** Pantoscopic pitch (rad) solved from hinge→tragion geometry. */
  pantoRad?: number;
  /** Iris-calibrated relative scale correction (1 = uncalibrated). */
  scaleCorrection?: number;
  /** Vertical FOV (deg) — must match the render camera (default: solver 63). */
  fovDeg?: number;
  modelCorrect?: Quaternion;
  debugLog?: boolean;
};

let lastPerspLogMs = 0;

/**
 * Head distance from camera (cm) from the transform matrix — the same depth the
 * glasses anchor uses, so the face-mesh occluder lands in the same metric space.
 */
export function perspectiveHeadDepth(
  transformMatrix: number[] | null,
): number | null {
  if (!decomposeHeadMatrix(transformMatrix, _mp)) return null;
  _mp.decompose(_posP, _quatP, _sclP);
  return Math.max(5, Math.abs(_posP.z) || 40);
}

/** Camera depth of landmark 168, the depth reference for MediaPipe landmark z. */
export function perspectiveFaceDepth(
  transformMatrix: number[] | null,
): number | null {
  if (!decomposeHeadMatrix(transformMatrix, _mp)) return null;
  const mid = CANONICAL_CM[LM.MID_EYES];
  const depth = -_seatWorld.set(mid[0], mid[1], mid[2]).applyMatrix4(_mp).z;
  return Number.isFinite(depth) && depth > 5 ? depth : null;
}

/**
 * Perspective-metric pose (Ray-Ban-Meta-style).
 *
 * Unlike the ortho path (which fakes Z and collapses temple arms), this places
 * the glasses at a real 3D point in a perspective camera:
 *  - DEPTH from the MediaPipe transform-matrix translation (metric cm). This is
 *    what makes temples recede toward the ears and pitch/foreshortening correct.
 *  - XY from the mid-eye landmark ray at that depth — reuses the reliable
 *    landmark eye-anchoring instead of trusting the matrix origin offset.
 *  - ROTATION from the matrix (real head orientation).
 *  - SCALE in real world units: frameWidthMm → cm, so the frame is its true
 *    physical size and apparent size tracks distance automatically (no
 *    calibration needed for scale).
 *
 * MediaPipe matrix data is row-major → transpose for three.js. The webcam feed
 * is CSS-mirrored, so we mirror X (position) and the quaternion's y,z.
 */
const _seatLocal = new Vector3();
const _seatWorld = new Vector3();
const _panto = new Quaternion();
const _trim = new Vector3();

export function computePosePerspective(input: PerspectiveInput): FitPose | null {
  const {
    landmarks,
    transformMatrix,
    aspect,
    frameWidthMm,
    nosePadOffsetMm = 0,
    scaleTune,
    yOffsetCm,
    zOffsetCm,
    headAnchors = null,
    pantoRad = 0,
    scaleCorrection = 1,
    fovDeg = PERSPECTIVE_FOV_DEG,
    modelCorrect = IDENTITY,
    debugLog = false,
  } = input;

  if (!decomposeHeadMatrix(transformMatrix, _mp)) return null;
  const mid = landmarks[LM.MID_EYES] ?? landmarks[LM.NOSE_BRIDGE];
  const leftIris = landmarks[LM.LEFT_IRIS];
  const rightIris = landmarks[LM.RIGHT_IRIS];
  if (!mid || !leftIris || !rightIris) return null;

  _mp.decompose(_posP, _quatP, _sclP);

  // Depth: distance of the head from the camera (cm), always positive.
  const depth = Math.max(5, Math.abs(_posP.z) || 40);

  const halfFov = (fovDeg * Math.PI) / 180 / 2;
  const tanHalf = Math.tan(halfFov);

  let position: Vector3;
  if (headAnchors) {
    // Anatomical path.
    //  DEPTH: the head-space sellion mapped through the head matrix. The
    //  matrix is a least-squares fit of the canonical face to the observed
    //  landmarks, so its depth is reliable while its XY carries the generic
    //  face's shape residual.
    //  XY: the ray through the OBSERVED sellion (lerp of landmarks 168→6,
    //  the same proportion the canonical seat uses). This is authoritative:
    //  it is the user's actual nose bridge in this frame, tracked in every
    //  pose, so the frame stays pixel-locked under yaw/pitch/distance. A
    //  calibrated seatHeadCm was measured from these same landmarks, so its
    //  XY is not re-applied (that would double count).
    //  OFFSETS: intentional 3D displacements (nose-pad standoff, per-user
    //  seatOffsetHeadCm) are rotated by the head pose and added in full.
    _seatWorld.copy(headAnchors.seatHeadCm).applyMatrix4(_mp);
    // Degenerate (rotation-only) matrices leave the seat near the camera
    // plane — fall back to the head depth rather than clamping to nonsense.
    const rawSeatDepth = -_seatWorld.z;
    const seatDepth = rawSeatDepth > depth * 0.5 ? rawSeatDepth : depth;

    // Observed pupil line: midpoint of the two iris centres (the most
    // precisely tracked landmarks). The glasses pivot is the lens centre, so
    // the lens-centre-below-pupil drop is applied as a head-local offset.
    const seatLmX = (leftIris.x + rightIris.x) / 2;
    const seatLmY = (leftIris.y + rightIris.y) / 2;
    position = new Vector3(
      (0.5 - seatLmX) * 2 * seatDepth * tanHalf * aspect, // mirrored
      (0.5 - seatLmY) * 2 * seatDepth * tanHalf,
      -seatDepth,
    );

    // Head-local offset → camera space via the (unmirrored) head rotation,
    // then mirror X to match the mirrored video.
    _seatLocal.set(0, -LENS_CENTER_BELOW_PUPIL_CM, nosePadOffsetMm / 10);
    if (headAnchors.seatOffsetHeadCm) _seatLocal.add(headAnchors.seatOffsetHeadCm);
    if (_seatLocal.lengthSq() > 0) {
      _seatLocal.applyQuaternion(_quatP);
      position.x -= _seatLocal.x;
      position.y += _seatLocal.y;
      position.z += _seatLocal.z;
    }
  } else {
    // Legacy fallback: ray through the mid-eye landmark at head depth.
    const worldX = (0.5 - mid.x) * 2 * depth * tanHalf * aspect;
    const worldY = (0.5 - mid.y) * 2 * depth * tanHalf;
    position = new Vector3(worldX, worldY, -depth);
  }

  // Rotation: head orientation × pantoscopic pitch, corrected for the GLB's
  // authored facing, then mirrored for the flipped video.
  if (pantoRad !== 0) {
    _panto.setFromAxisAngle(_trim.set(1, 0, 0), pantoRad);
    _quatP.multiply(_panto);
  }
  _quatP.multiply(modelCorrect);
  _quatP.set(_quatP.x, -_quatP.y, -_quatP.z, _quatP.w).normalize();

  // Residual trims (default 0) along the head's own down/forward.
  if (yOffsetCm !== 0 || zOffsetCm !== 0) {
    const down = new Vector3(0, -1, 0).applyQuaternion(_quatP);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(_quatP);
    position.addScaledVector(down, yOffsetCm);
    position.addScaledVector(fwd, zOffsetCm);
  }

  // True physical width: model is normalized to width 1 → frameWidthMm in cm,
  // corrected by the iris-calibrated relative scale when available.
  const scale = (frameWidthMm / 10) * scaleCorrection * scaleTune;

  if (debugLog) {
    const now = performance.now();
    if (now - lastPerspLogMs > 500) {
      lastPerspLogMs = now;
      _euler.setFromQuaternion(_quatP, "YXZ");
      console.info(
        `[EyeNetra:persp] depth=${depth.toFixed(1)}cm pos=(${position.x.toFixed(1)},${position.y.toFixed(1)},${position.z.toFixed(1)}) yaw=${((_euler.y * 180) / Math.PI).toFixed(1)} pitch=${((_euler.x * 180) / Math.PI).toFixed(1)} scale=${scale.toFixed(1)} panto=${((pantoRad * 180) / Math.PI).toFixed(1)}°`,
      );
    }
  }

  return {
    position,
    quaternion: _quatP.clone(),
    scale,
    liveScale: scale,
    calibScale: null,
  };
}

/** @deprecated Use computePose — kept as alias during provider migration. */
export function computePose3D(
  landmarks: LandmarkPoint[],
  transformMatrix: number[] | null,
  aspect: number,
  scaleMul: number,
  yOffsetFrac: number,
  modelCorrect: Quaternion,
  debugLog: boolean,
  frameWidthMm = 140,
  faceProfile: FaceProfile | null = null,
): FitPose | null {
  return computePose({
    landmarks,
    transformMatrix,
    aspect,
    scaleMul,
    yOffsetFrac,
    frameWidthMm,
    faceProfile,
    modelCorrect,
    debugLog,
  });
}
