import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { LM } from "@/lib/mediapipe/constants";
import { landmarkToWorld } from "@/lib/coords";
import type { FaceProfile } from "@/lib/faceProfile";
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
  if (!faceProfile || !(faceProfile.faceWidthMm > 0)) {
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
