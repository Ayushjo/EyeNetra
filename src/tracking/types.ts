import type { LandmarkPoint } from "@/store/tryOnStore";

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

/**
 * Provider-agnostic tracking output. Downstream (fit engine, glasses, UI)
 * must consume this shape only — never MediaPipe/Jeeliz internals.
 */
export type TrackingFrame = {
  hasFace: boolean;
  position: Vec3;
  rotation: Quat;
  scale: number;
  liveScale: number;
  calibScale: number | null;
  /** Present for MediaPipe (calibration / landmark overlay). Absent for Jeeliz. */
  landmarks?: LandmarkPoint[];
  videoWidth: number;
  videoHeight: number;
  /**
   * MediaPipe facialTransformationMatrixes — used by computePose (provider +
   * useFitEngine fallback) and HQ capture re-pose.
   */
  transformMatrix?: number[] | null;
  /**
   * Perspective (anatomical) pose, computed once per detection alongside the
   * ortho pose above. useFitEngine consumes this in perspective render mode.
   */
  anchorPose?: {
    position: Vec3;
    rotation: Quat;
    scale: number;
  } | null;
  /** Pantoscopic pitch applied (rad) — diagnostics. */
  pantoRad?: number;
  /** Head distance from camera (cm) from the transform matrix. */
  depthCm?: number | null;
  /** Video-frame media time (ms) — filter time base. */
  timestampMs?: number;
  /** performance.now() when the detection finished — prediction offset base. */
  detectedAtMs?: number;
};

export type TrackingProviderId = "mediapipe" | "jeeliz";

export interface TrackingProvider {
  readonly id: TrackingProviderId;
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  getFrame(): TrackingFrame | null;
}
