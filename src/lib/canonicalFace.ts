import { Vector3 } from "three";

/**
 * Head-local metric coordinates (cm) of selected canonical-face vertices.
 *
 * Extracted from MediaPipe's canonical_face_model.obj
 * (https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj,
 * Apache License 2.0, Copyright 2020 The MediaPipe Authors) via
 * scripts/extract-canonical-face.mjs.
 *
 * Convention (verified in canonicalFace.test.ts): units are cm in the same
 * head-local frame the facialTransformationMatrix maps to camera space.
 * +X is the subject's left (landmark index 454 side), +Y up, +Z toward the
 * camera (nose tip has the largest +Z).
 */
export const CANONICAL_CM: Record<number, readonly [number, number, number]> = {
  1: [0, -1.126865, 7.475604],
  4: [0, -0.46317, 7.58658],
  6: [0, 2.473255, 5.788627],
  10: [0, 8.261778, 4.481535],
  33: [-4.445859, 2.663991, 3.173422],
  93: [-7.542244, -1.049282, -2.431321],
  127: [-7.743095, 2.364999, -2.005167],
  133: [-1.856432, 2.585245, 3.757904],
  152: [0, -9.403378, 4.264492],
  168: [0, 3.271027, 5.236015],
  195: [0, 1.059413, 6.774605],
  197: [0, 1.728369, 6.31675],
  234: [-7.664182, 0.673132, -2.435867],
  263: [4.445859, 2.663991, 3.173422],
  323: [7.542244, -1.049282, -2.431321],
  356: [7.743095, 2.364999, -2.005167],
  362: [1.856432, 2.585245, 3.757904],
  454: [7.664182, 0.673132, -2.435867],
};

export function canonicalVec(index: number): Vector3 {
  const v = CANONICAL_CM[index];
  if (!v) throw new Error(`canonicalFace: vertex ${index} not vendored`);
  return new Vector3(v[0], v[1], v[2]);
}

/**
 * Nose-bridge seat (sellion area): where glasses nose pads rest. Vertex 168
 * (mid-eyes) is slightly above the true seat; vertex 6 slightly below —
 * blend toward 6.
 */
export const CANONICAL_SELLION: Vector3 = canonicalVec(168).lerp(
  canonicalVec(6),
  0.6,
);

/**
 * Lens-plane fit point (optician's pupil-height rule): x centred, y on the
 * pupil line (mean of the four canthi — the irises are not in the canonical
 * mesh) minus the pupil-above-lens-centre drop, z at the sellion (the plane a
 * pad-resting frame front sits in). The GLB pivot is the lens-mesh centre, so
 * this is where that centre goes in head space.
 */
export const LENS_CENTER_BELOW_PUPIL_CM = 0.3;
/** Cornea apex sits ~0.9 cm in front of the canthi plane. */
export const CORNEA_AHEAD_OF_CANTHI_CM = 0.9;
/** Pupil line midpoint in head space (what the iris landmarks observe). */
export const CANONICAL_PUPIL_MID: Vector3 = new Vector3(
  0,
  (canonicalVec(33).y + canonicalVec(133).y + canonicalVec(362).y + canonicalVec(263).y) / 4,
  (canonicalVec(33).z + canonicalVec(133).z + canonicalVec(362).z + canonicalVec(263).z) / 4 +
    CORNEA_AHEAD_OF_CANTHI_CM,
);
export const CANONICAL_LENS_FIT: Vector3 = new Vector3(
  0,
  CANONICAL_PUPIL_MID.y - LENS_CENTER_BELOW_PUPIL_CM,
  CANONICAL_SELLION.z,
);
/** Lens plane ahead of the pupils (vertex distance incl. pad standoff). */
export const LENS_AHEAD_OF_PUPIL_CM = CANONICAL_LENS_FIT.z - CANONICAL_PUPIL_MID.z;

/**
 * The canonical mesh has no ears. Vertices 234/454 sit at the cheek-ear
 * junction, ahead of and slightly below the tragus, so the tragion estimate
 * is that vertex pushed back, up, and slightly outward. This offset is the
 * main empirical tuning point for temple seating (dev slider: tragionTune).
 */
export const TRAGION_OFFSET_CM = { back: 1.2, up: 0.2, out: 0.3 } as const;

export function canonicalTragion(
  side: "L" | "R",
  tune?: { backCm: number; upCm: number },
): Vector3 {
  const base = canonicalVec(side === "L" ? 234 : 454);
  const back = tune?.backCm ?? TRAGION_OFFSET_CM.back;
  const up = tune?.upCm ?? TRAGION_OFFSET_CM.up;
  const sign = side === "L" ? -1 : 1;
  return base
    .add(new Vector3(sign * TRAGION_OFFSET_CM.out, up, -back));
}

/**
 * Pupil-to-pupil distance of the canonical face (mm), from the eye centres
 * (canthi means). Meta's try-on uses 63.2 mm for the same model; this
 * evaluates to ≈63.0.
 */
export const CANONICAL_PD_MM =
  Math.abs(
    (canonicalVec(362).x + canonicalVec(263).x) / 2 - (canonicalVec(33).x + canonicalVec(133).x) / 2,
  ) * 10;
