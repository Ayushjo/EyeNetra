import { buildTrackingFrame } from "@/tracking/buildTrackingFrame";
import { solveHeadPosePnP } from "@/lib/pnp";
import { useTryOnStore, type LandmarkPoint } from "@/store/tryOnStore";
import type { TrackingFrame } from "@/tracking/types";

/** PnP solves worse than this (px RMS) fall back to the MediaPipe matrix. */
const PNP_MAX_RMS_PX = 25;

/**
 * Longest side of the image handed to the detector. MediaPipe crops the face
 * and resizes it to 192–256 px internally, so a full 1280×720 frame buys no
 * accuracy — but the CPU path must read every input pixel back from the GPU,
 * and that readback was the tracker's main cost (≈ 4× the inference itself
 * at 720p). 960 keeps iris landmarks (fit-size measurement) sharp.
 */
export const DETECT_MAX_SIDE = 960;

let lastPnpLogMs = 0;

/**
 * Detector output → TrackingFrame, shared by the main-thread and worker
 * trackers so both feed the fit engine exactly the same way.
 */
export function mediapipeTrackingFrame(input: {
  landmarks: LandmarkPoint[] | null;
  mediapipeMatrix: number[] | null;
  videoWidth: number;
  videoHeight: number;
  timestampMs: number;
  detectedAtMs: number;
  frameAtMs: number;
  receivedAtMs: number;
}): TrackingFrame {
  const { landmarks, mediapipeMatrix, videoWidth, videoHeight } = input;
  const store = useTryOnStore.getState();
  // Head pose by PnP on 33 rigid landmarks under the render camera's own
  // intrinsics (technique from Meta's try-on; lib/pnp.ts). The MediaPipe
  // matrix seeds the solve and remains the fallback.
  let transformMatrix = mediapipeMatrix;
  if (landmarks && mediapipeMatrix) {
    const pnp = solveHeadPosePnP(
      landmarks, mediapipeMatrix, videoWidth, videoHeight, store.cameraCalib.fovDeg,
    );
    if (pnp && pnp.rmsPx < PNP_MAX_RMS_PX) transformMatrix = pnp.matrix;
    const now = performance.now();
    if (store.debugPoseLog && pnp && now - lastPnpLogMs > 1000) {
      lastPnpLogMs = now;
      console.info(`[EyeNetra:pnp] rms=${pnp.rmsPx.toFixed(2)}px it=${pnp.iterations}`);
    }
  }
  const sku = store.selectedFrame();
  const frame = buildTrackingFrame({
    landmarks,
    transformMatrix,
    videoWidth,
    videoHeight,
    timestampMs: input.timestampMs,
    detectedAtMs: input.detectedAtMs,
    sku,
    faceProfile: store.faceProfile,
    headAnchors: store.headAnchors,
    glassesGeom: store.glassesGeom[sku.id] ?? null,
    perspTune: store.perspTune,
    cameraCalib: store.cameraCalib,
    debugLog: store.debugPoseLog,
  });
  frame.frameAtMs = input.frameAtMs;
  frame.receivedAtMs = input.receivedAtMs;
  return frame;
}
