/** MediaPipe Face Mesh landmark indices used by the fit engine. */
export const LM = {
  /** Left iris center (subject's left = image right in unmirrored feed). */
  LEFT_IRIS: 468,
  RIGHT_IRIS: 473,
  /** Iris diameter sample points (horizontal). */
  LEFT_IRIS_INNER: 471,
  LEFT_IRIS_OUTER: 469,
  RIGHT_IRIS_INNER: 474,
  RIGHT_IRIS_OUTER: 476,
  /** Eye corners for IPD / bridge. */
  LEFT_EYE_OUTER: 33,
  LEFT_EYE_INNER: 133,
  RIGHT_EYE_INNER: 362,
  RIGHT_EYE_OUTER: 263,
  NOSE_BRIDGE: 6,
  /** Midpoint between the eyes — best horizontal anchor for frames. */
  MID_EYES: 168,
  NOSE_TIP: 1,
  FOREHEAD: 10,
  CHIN: 152,
  /**
   * Near-tragion / cheek-ear junction (MediaPipe face mesh).
   * Used for temple occlusion cards — NOT the full face oval.
   */
  LEFT_EAR: 234,
  RIGHT_EAR: 454,
} as const;

/** Average adult iris diameter in millimeters — real-world scale reference. */
export const IRIS_DIAMETER_MM = 11.7;

export const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** Local WASM fileset (copied from node_modules into public/). */
export const WASM_BASE_PATH = "/mediapipe/wasm";
