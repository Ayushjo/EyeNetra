/**
 * Jeeliz FaceFilter calibration research notes (Part 3 gate).
 *
 * FaceFilter `callbackTrack(detectState)` provides:
 *   detected, x, y, s, rx, ry, rz
 * It does NOT provide dense mesh landmarks, iris centers, or pupil radii.
 *
 * Iris / pupil measurement lives in a separate Jeeliz product
 * (jeelizPupillometry / GazeFilter), not FaceFilter.
 *
 * Therefore EyeNetra keeps MediaPipe for the one-shot “Get your fit size”
 * iris→mm calibration. Live try-on may use Jeeliz via TrackingProviderToggle;
 * calibration UI disables itself while Jeeliz is the active live provider.
 */
export const JEELIZ_HAS_IRIS_LANDMARKS = false;
