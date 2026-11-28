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
  /**
   * performance.now() when the analysed camera frame became available —
   * how old the pose really is ("predict from capture time").
   */
  frameAtMs?: number;
  /** performance.now() when this page thread got the result (dev timing). */
  receivedAtMs?: number;
};

export type TrackingProviderId = "mediapipe" | "jeeliz";

/** Where face detection runs (staff option; SYNC display forces "main"). */
export type DetectEngine = "main" | "worker-cpu" | "worker-gpu";

/** Once a second from the active tracker — staff panel readout. */
export type TrackerStats = {
  engine: DetectEngine;
  /** Mean time inside detectForVideo over the last second (ms). */
  detectMs: number | null;
};

export interface TrackingProvider {
  readonly id: TrackingProviderId;
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  getFrame(): TrackingFrame | null;
}
