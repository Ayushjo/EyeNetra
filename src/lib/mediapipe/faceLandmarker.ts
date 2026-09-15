import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { FACE_LANDMARKER_MODEL_URL, WASM_BASE_PATH } from "./constants";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/**
 * Lazily create a singleton FaceLandmarker in VIDEO mode.
 *
 * IMPORTANT: defaults to the CPU delegate. The GPU delegate competed for the
 * same WebGL context as the R3F canvas and caused "THREE.WebGLRenderer:
 * Context Lost" — which silently wiped the canvas while the <video> feed kept
 * rendering. CPU is plenty for one face at 30+ FPS on modern hardware.
 */
export function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
          // CPU avoids fighting R3F for the WebGL context (context-lost bugs).
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

export type { FaceLandmarkerResult };
export { FaceLandmarker };
