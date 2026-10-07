import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { LM } from "@/lib/mediapipe/constants";
import { landmarkToWorld } from "@/lib/coords";
import type { FaceProfile } from "@/lib/faceProfile";
import { decomposeHeadMatrix, type HeadAnchors } from "@/lib/headAnchors";
import {
  CORNEA_AHEAD_OF_CANTHI_CM,
  LENS_AHEAD_OF_PUPIL_CM,
  LENS_CENTER_BELOW_PUPIL_CM,
} from "@/lib/canonicalFace";
import { CANONICAL_MESH_CM } from "@/lib/canonicalFaceMesh";
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

/** |yaw| range (deg) over which placement hands over to the near eye. */
export const YAW_BLEND_DEG: [number, number] = [18, 32];
const _eyeA = new Vector3();
const _eyeB = new Vector3();
const _delta = new Vector3();
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** Head-local pupil estimate for eye 0 (canthi 33/133, iris 468) or 1 (362/263, iris 473). */
export function eyeCanonical(which: 0 | 1, out: Vector3): Vector3 {
  const [i, j] = which === 0 ? [33, 133] : [362, 263];
  out.set(
    (CANONICAL_MESH_CM[i * 3] + CANONICAL_MESH_CM[j * 3]) / 2,
    (CANONICAL_MESH_CM[i * 3 + 1] + CANONICAL_MESH_CM[j * 3 + 1]) / 2,
    (CANONICAL_MESH_CM[i * 3 + 2] + CANONICAL_MESH_CM[j * 3 + 2]) / 2 + CORNEA_AHEAD_OF_CANTHI_CM,
  );
  return out;
}

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
    // Depth of the PUPIL line (what the iris landmarks actually observe):
    // the lens-fit seat minus its own ahead/below offsets, through the head
    // matrix. Ray-casting the iris pixel to the lens-plane depth instead
    // produced ~1.5 cm·sin(yaw) of lateral parallax error (frame slid
    // forward/sideways on turns, live 5 Oct).
    _seatLocal
      .copy(headAnchors.seatHeadCm)
      .add(_trim.set(0, LENS_CENTER_BELOW_PUPIL_CM, -LENS_AHEAD_OF_PUPIL_CM));
    _seatWorld.copy(_seatLocal).applyMatrix4(_mp);
    // Degenerate (rotation-only) matrices leave the point near the camera
    // plane — fall back to the head depth rather than clamping to nonsense.
    const rawPupilDepth = -_seatWorld.z;
    const pupilDepth = rawPupilDepth > depth * 0.5 ? rawPupilDepth : depth;

    const seatLmX = (leftIris.x + rightIris.x) / 2;
    const seatLmY = (leftIris.y + rightIris.y) / 2;
    position = new Vector3(
      (0.5 - seatLmX) * 2 * pupilDepth * tanHalf * aspect, // mirrored
      (0.5 - seatLmY) * 2 * pupilDepth * tanHalf,
      -pupilDepth,
    );

    // Turned head: the far eye is hidden behind the nose and MediaPipe only
    // guesses its iris, so the two-iris midpoint slides (live 7 Oct: frame
    // displaced at ~60° yaw). Past ~18° blend to the head-matrix pupil point,
    // XY-locked to the NEAR iris, which stays visible.
    _euler.setFromQuaternion(_quatP, "YXZ");
    const yawW = smoothstep(YAW_BLEND_DEG[0], YAW_BLEND_DEG[1], Math.abs((_euler.y * 180) / Math.PI));
    if (yawW > 0 && rawPupilDepth > depth * 0.5) {
      eyeCanonical(0, _eyeA).applyMatrix4(_mp);
      eyeCanonical(1, _eyeB).applyMatrix4(_mp);
      const nearA = -_eyeA.z < -_eyeB.z;
      const eye = nearA ? _eyeA : _eyeB;
      const iris = nearA ? leftIris : rightIris;
      const d = -eye.z;
      // Observed near iris at the predicted eye depth (unmirrored camera space).
      _delta.set(
        (iris.x - 0.5) * 2 * d * tanHalf * aspect - eye.x,
        (0.5 - iris.y) * 2 * d * tanHalf - eye.y,
        0,
      );
      _trim.copy(_seatWorld).add(_delta);
      _trim.x = -_trim.x; // mirror
      position.lerp(_trim, yawW);
    }

    // Pupil → lens-centre offset in head space (down, ahead to the lens
    // plane, plus nose-pad standoff and any per-user offset), rotated by the
    // (unmirrored) head pose, then mirrored in X for the mirrored video.
    _seatLocal.set(
      0,
      -LENS_CENTER_BELOW_PUPIL_CM,
      LENS_AHEAD_OF_PUPIL_CM + nosePadOffsetMm / 10,
    );
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
