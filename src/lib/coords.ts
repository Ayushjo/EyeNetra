import type { LandmarkPoint } from "@/store/tryOnStore";

/**
 * Map MediaPipe normalized landmark → orthographic overlay space.
 * Video must be 1:1 with the stage (matched aspect + object-fill).
 */
export function landmarkToWorld(
  lm: LandmarkPoint,
  aspect: number,
): { x: number; y: number; z: number } {
  return {
    x: (0.5 - lm.x) * 2 * aspect, // mirror for CSS scaleX(-1)
    y: -(lm.y - 0.5) * 2,
    z: -lm.z * aspect,
  };
}

export function dist3(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
