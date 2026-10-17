import { computePose, computePosePerspective, perspectiveFaceDepth } from "@/lib/fitPose";
import { frameTiltRad, type GlassesGeom, type HeadAnchors } from "@/lib/headAnchors";
import type { FaceProfile } from "@/lib/faceProfile";
import type { FrameSku } from "@/data/frames";
import type { LandmarkPoint } from "@/store/tryOnStore";
import type { TrackingFrame } from "@/tracking/types";

export type BuildFrameInput = {
  landmarks: LandmarkPoint[] | null;
  transformMatrix: number[] | null;
  videoWidth: number;
  videoHeight: number;
  timestampMs: number;
  detectedAtMs: number;
  sku: FrameSku;
  faceProfile: FaceProfile | null;
  headAnchors: HeadAnchors;
  glassesGeom: GlassesGeom | null;
  perspTune: { yOffsetCm: number; zOffsetCm: number; scaleTune: number };
  cameraCalib?: { fovDeg: number; scaleCorrection: number };
  debugLog?: boolean;
};

const NO_FACE = {
  hasFace: false as const,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: 1,
  liveScale: 1,
  calibScale: null,
};

/**
 * Single place both poses are computed per detection: the ortho overlay pose
 * (legacy path) and the perspective anatomical pose. Pure — unit-testable
 * with the pose fixtures.
 */
export function buildTrackingFrame(input: BuildFrameInput): TrackingFrame {
  const {
    landmarks,
    transformMatrix,
    videoWidth,
    videoHeight,
    timestampMs,
    detectedAtMs,
    sku,
    faceProfile,
    headAnchors,
    glassesGeom,
    perspTune,
    cameraCalib,
    debugLog = false,
  } = input;

  const base = {
    landmarks: landmarks ?? undefined,
    videoWidth,
    videoHeight,
    transformMatrix,
    timestampMs,
    detectedAtMs,
  };

  if (!landmarks || !transformMatrix) {
    return { ...NO_FACE, ...base, anchorPose: null, depthCm: null };
  }

  const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
  const orthoPose = computePose({
    landmarks,
    transformMatrix,
    aspect,
    scaleMul: sku.fit.scaleMul,
    yOffsetFrac: sku.fit.yOffsetFrac,
    frameWidthMm: sku.fit.frameWidthMm,
    faceProfile,
    debugLog,
  });

  // Physical width: prefer the maker's lens span mapped through the GLB's
  // measured lens span (exact), else the nominal bbox width.
  const effectiveWidthMm =
    sku.fit.lensSpanMm && glassesGeom?.lensSpanNorm && glassesGeom.lensSpanNorm > 0.2
      ? sku.fit.lensSpanMm / glassesGeom.lensSpanNorm
      : sku.fit.frameWidthMm;
  const scaleTune = (sku.fit.perspScaleTune ?? 1) * perspTune.scaleTune;
  // Fixed per-product tilt (Meta's arrangement), not a per-user solve.
  const pantoRad = frameTiltRad(sku.fit);
  const perspPose = computePosePerspective({
    landmarks,
    transformMatrix,
    aspect,
    frameWidthMm: effectiveWidthMm,
    nosePadOffsetMm: sku.fit.nosePadOffsetMm,
    scaleTune,
    yOffsetCm: (sku.fit.perspYOffsetCm ?? 0) + perspTune.yOffsetCm,
    zOffsetCm: (sku.fit.perspZOffsetCm ?? 0) + perspTune.zOffsetCm,
    headAnchors,
    pantoRad,
    scaleCorrection: cameraCalib?.scaleCorrection ?? 1,
    fovDeg: cameraCalib?.fovDeg,
    debugLog,
  });

  const depthCm = perspPose
    ? (perspectiveFaceDepth(transformMatrix) ?? -perspPose.position.z)
    : null;

  if (!orthoPose) {
    return {
      ...NO_FACE,
      ...base,
      hasFace: !!perspPose,
      anchorPose: perspPose
        ? {
            position: {
              x: perspPose.position.x,
              y: perspPose.position.y,
              z: perspPose.position.z,
            },
            rotation: {
              x: perspPose.quaternion.x,
              y: perspPose.quaternion.y,
              z: perspPose.quaternion.z,
              w: perspPose.quaternion.w,
            },
            scale: perspPose.scale,
          }
        : null,
      depthCm,
    };
  }

  return {
    hasFace: true,
    position: {
      x: orthoPose.position.x,
      y: orthoPose.position.y,
      z: orthoPose.position.z,
    },
    rotation: {
      x: orthoPose.quaternion.x,
      y: orthoPose.quaternion.y,
      z: orthoPose.quaternion.z,
      w: orthoPose.quaternion.w,
    },
    scale: orthoPose.scale,
    liveScale: orthoPose.liveScale,
    calibScale: orthoPose.calibScale,
    ...base,
    anchorPose: perspPose
      ? {
          position: {
            x: perspPose.position.x,
            y: perspPose.position.y,
            z: perspPose.position.z,
          },
          rotation: {
            x: perspPose.quaternion.x,
            y: perspPose.quaternion.y,
            z: perspPose.quaternion.z,
            w: perspPose.quaternion.w,
          },
          scale: perspPose.scale,
        }
      : null,
    depthCm,
    pantoRad,
  };
}
