import { describe, expect, it } from "vitest";
import { LM } from "@/lib/mediapipe/constants";
import type { LandmarkPoint } from "@/store/tryOnStore";
import {
  robustProfileFromMeasures,
  buildProfileFromMeasures,
  measureFacePx,
  fitIrisCircle,
  PD_CONVERGENCE_FACTOR,
  pxToMm,
  stableMeasureIndices,
  type FaceMeasurePx,
} from "./faceProfile";

describe("face calibration samples", () => {
  it("measures both image axes in pixels on a non-square video", () => {
    const width = 1280;
    const height = 720;
    const landmarks: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    // A 12 px diagonal iris diameter, with a 120 px diagonal canthal span.
    landmarks[LM.LEFT_IRIS_OUTER] = { x: 300 / width, y: 300 / height, z: 0 };
    landmarks[LM.LEFT_IRIS_INNER] = { x: 300 / width, y: 312 / height, z: 0 };
    landmarks[LM.RIGHT_IRIS_OUTER] = { x: 400 / width, y: 300 / height, z: 0 };
    landmarks[LM.RIGHT_IRIS_INNER] = { x: 400 / width, y: 312 / height, z: 0 };
    // Full four-point contours (MediaPipe always emits all four).
    landmarks[470] = { x: 294 / width, y: 306 / height, z: 0 };
    landmarks[472] = { x: 306 / width, y: 306 / height, z: 0 };
    landmarks[475] = { x: 394 / width, y: 306 / height, z: 0 };
    landmarks[477] = { x: 406 / width, y: 306 / height, z: 0 };
    landmarks[LM.LEFT_IRIS] = { x: 300 / width, y: 306 / height, z: 0 };
    landmarks[LM.RIGHT_IRIS] = { x: 400 / width, y: 306 / height, z: 0 };
    landmarks[LM.LEFT_EYE_OUTER] = { x: 290 / width, y: 300 / height, z: 0 };
    landmarks[LM.RIGHT_EYE_OUTER] = { x: 410 / width, y: 300 / height, z: 0 };
    const measure = measureFacePx(landmarks, 0.2, width, height)!;
    expect(measure.irisDiamPx).toBeCloseTo(12, 6);
    expect(measure.faceWidthPx).toBeCloseTo(120, 6);
    expect(pxToMm(measure).faceWidthMm).toBeCloseTo(117, 6);
  });

  it("circle fit recovers centre and radius; PD uses the fitted centres + convergence", () => {
    const width = 1280, height = 720;
    const lm: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const put = (ids: number[], cx: number, cy: number, r: number) => {
      const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
      ids.forEach((id, k) => (lm[id] = { x: (cx + r * Math.cos(angles[k])) / width, y: (cy + r * Math.sin(angles[k])) / height, z: 0 }));
    };
    put([469, 470, 471, 472], 500, 300, 7);
    put([474, 475, 476, 477], 620, 300, 7);
    const c = fitIrisCircle(lm, [469, 470, 471, 472], width, height)!;
    expect(c.cx).toBeCloseTo(500, 6);
    expect(c.r).toBeCloseTo(7, 6);
    lm[33] = { x: 470 / width, y: 300 / height, z: 0 };
    lm[263] = { x: 650 / width, y: 300 / height, z: 0 };
    lm[468] = { x: 500 / width, y: 300 / height, z: 0 };
    lm[473] = { x: 620 / width, y: 300 / height, z: 0 };
    const m = measureFacePx(lm, 0.2, width, height)!;
    expect(m.irisDiamPx).toBeCloseTo(14, 6);
    expect(m.ipdPx).toBeCloseTo(120, 6);
    // 120 px / 14 px × 11.7 mm × 1.02625
    expect(pxToMm(m).ipdMm).toBeCloseTo((120 / 14) * 11.7 * PD_CONVERGENCE_FACTOR, 6);
  });

  it("exposes the exact accepted indices for paired pose/measurement samples", () => {
    const mk = (x: number): FaceMeasurePx => ({
      eyeOpenness: 1, irisDiamPx: 12, ipdPx: 60, faceWidthPx: 100,
      midEyeX: x, midEyeY: 0.5, eyeSpanScene: 0.2,
    });
    const measures = [mk(0.5), mk(0.502), mk(0.55), mk(0.504)];
    expect(stableMeasureIndices(measures)).toEqual([0, 1, 3]);
    expect(buildProfileFromMeasures(measures, 0.008, 3)).not.toBeNull();
    expect(buildProfileFromMeasures(measures, 0.008, 4)).toBeNull();
  });
});

describe("robustProfileFromMeasures", () => {
  const base = (irisDiamPx: number, eyeOpenness = 1) => ({
    irisDiamPx,
    eyeOpenness,
    ipdPx: 320,
    faceWidthPx: 420,
    midEyeX: 0.5,
    midEyeY: 0.5,
    eyeSpanScene: 0.6,
  });

  it("ignores blink frames and is robust to outliers (median, MAD σ)", () => {
    const measures = [
      ...Array.from({ length: 20 }, () => base(60)),
      base(45, 0.3), // blink: tiny aperture → excluded
      base(40), // outlier iris → cannot drag the median
    ];
    const r = robustProfileFromMeasures(measures, 10)!;
    expect(r).not.toBeNull();
    expect(r.n).toBe(21);
    // 11.7 mm / 60 px × 420 px = 81.9 mm
    expect(r.profile.faceWidthMm).toBeCloseTo(81.9, 1);
    expect(r.sigmaMm).toBeLessThan(0.01);
  });

  it("reports a wide σ when samples disagree", () => {
    const measures = Array.from({ length: 30 }, (_, i) => base(55 + (i % 2) * 6));
    const r = robustProfileFromMeasures(measures, 10)!;
    expect(r.sigmaMm).toBeGreaterThan(3);
  });

  it("needs enough open-eye samples", () => {
    expect(robustProfileFromMeasures(Array.from({ length: 12 }, () => base(60, 0.4)), 10)).toBeNull();
  });
});
