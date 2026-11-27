import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { FACE_LANDMARKER_MODEL_URL, WASM_BASE_PATH } from "./constants";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

// MediaPipe's WASM prints its TFLite/XNNPACK init notes through console.error
// asynchronously (outside any detect() call), which Next's dev overlay counts
// as an application error. Drop just those known info lines, once, globally —
// installed when this module loads, before any MediaPipe code runs. (It used
// to be installed inside a temporary console swap, whose restore threw the
// filter away, so the dev overlay kept reporting a false "issue".)
const MEDIAPIPE_NOISE = /Created TensorFlow Lite|XNNPACK|^INFO:|^W0000|inference_feedback_manager/;
let consoleFiltered = false;
function filterMediapipeConsoleNoise() {
  if (consoleFiltered || typeof console === "undefined") return;
  consoleFiltered = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === "string" && MEDIAPIPE_NOISE.test(args[0])) return;
      original.apply(console, args as Parameters<typeof original>);
    };
  }
}
if (typeof window !== "undefined") filterMediapipeConsoleNoise();

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
    filterMediapipeConsoleNoise();
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
