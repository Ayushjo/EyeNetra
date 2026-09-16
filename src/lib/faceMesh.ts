import { FaceLandmarker } from "@mediapipe/tasks-vision";

/** Installed MediaPipe tessellation stores each triangle as three directed edges.
 * Preserve anatomical topology regardless of the first camera pose. Iris points
 * are deliberately excluded: they are not part of the face occlusion surface.
 */
export function triangleIndices(edges: readonly { start: number; end: number }[]): number[] {
  if (edges.length % 3 !== 0) throw new Error("Incomplete face tessellation");
  const indices: number[] = [];
  for (let i = 0; i < edges.length; i += 3) {
    const [a, b, c] = edges.slice(i, i + 3);
    if (a.end !== b.start || b.end !== c.start || c.end !== a.start ||
        [a.start, b.start, c.start].some(v => v < 0 || v >= 468) ||
        new Set([a.start, b.start, c.start]).size !== 3) {
      throw new Error("Invalid MediaPipe triangle");
    }
    indices.push(a.start, b.start, c.start);
  }
  return indices;
}

export const FACE_TRIANGLES = triangleIndices(FaceLandmarker.FACE_LANDMARKS_TESSELATION);
