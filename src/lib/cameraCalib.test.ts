import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CANONICAL_CM } from "@/lib/canonicalFace";
import {
  computeScaleCorrection,
  depthCrossCheck,
  estimateFocalFit,
} from "@/lib/cameraCalib";
import {
  canonicalHeadAnchors,
  refineHeadAnchors,
  type AnchorSample,
} from "@/lib/headAnchors";
import type { FaceProfile } from "@/lib/faceProfile";
import type { LandmarkPoint } from "@/store/tryOnStore";

const ASPECT = 16 / 9;

/**
 * Synthesize landmarks by projecting the canonical vertices through a known
 * camera — the estimator must recover that camera's FOV.
 */
function synthesize(fovDeg: number, depthCm: number) {
  const tanHalf = Math.tan(((fovDeg / 2) * Math.PI) / 180);
  // Row-major identity rotation + translation (0, 0, -depth).
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -depthCm, 0, 0, 0, 1];
  const m = new Matrix4().fromArray(matrix).transpose();
  const landmarks: LandmarkPoint[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  const p = new Vector3();
  const midZcam = -depthCm + CANONICAL_CM[168][2];
  for (const key of Object.keys(CANONICAL_CM)) {
    const idx = Number(key);
    const c = CANONICAL_CM[idx];
    p.set(c[0], c[1], c[2]).applyMatrix4(m);
    const d = -p.z;
    landmarks[idx] = {
      x: 0.5 + p.x / (2 * d * tanHalf * ASPECT),
      y: 0.5 - p.y / (2 * d * tanHalf),
      // MediaPipe-style relative z (image-width units, larger = farther),
      // anchored at landmark 168's camera depth.
      z: (midZcam - p.z) / (2 * -midZcam * tanHalf * ASPECT),
    };
  }
  return { landmarks, matrix };
}

describe("estimateFocalFit", () => {
  it("recovers the synthesizing FOV", () => {
    for (const fov of [50, 63, 75]) {
      const { landmarks, matrix } = synthesize(fov, 45);
      const fit = estimateFocalFit(landmarks, matrix, ASPECT)!;
      expect(fit).not.toBeNull();
      expect(fit.fovDeg).toBeCloseTo(fov, 1);
      expect(fit.rms).toBeLessThan(1e-6);
    }
  });

  it("rejects degenerate input", () => {
    expect(estimateFocalFit([], null, ASPECT)).toBeNull();
    const { landmarks } = synthesize(63, 45);
    // Rotation-only matrix → head at camera origin → invalid depths.
    expect(
      estimateFocalFit(
        landmarks,
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        ASPECT,
      ),
    ).toBeNull();
  });
});

describe("computeScaleCorrection", () => {
  const profile = (faceWidthMm: number): FaceProfile => ({
    ipdMm: 63,
    faceWidthMm,
    refEyeSpanScene: 0.5,
    capturedAt: Date.now(),
  });

  it("is 1 when the profile matches the scene-projected canthal width", () => {
    const { landmarks, matrix } = synthesize(63, 45);
    // Canonical canthal width is the ground truth of the synthetic scene.
    const trueWidthMm =
      Math.hypot(
        CANONICAL_CM[263][0] - CANONICAL_CM[33][0],
        CANONICAL_CM[263][1] - CANONICAL_CM[33][1],
      ) * 10;
    const c = computeScaleCorrection(
      landmarks,
      matrix,
      ASPECT,
      63,
      profile(trueWidthMm),
    );
    // xy-projection only → small foreshortening residual allowed.
    expect(c).toBeGreaterThan(0.97);
    expect(c).toBeLessThan(1.03);
  });

  it("clamps and guards corrupt profiles", () => {
    const { landmarks, matrix } = synthesize(63, 45);
    expect(
      computeScaleCorrection(landmarks, matrix, ASPECT, 63, profile(500)),
    ).toBe(1);
    expect(
      computeScaleCorrection(landmarks, matrix, ASPECT, 63, profile(25)),
    ).toBe(1.4);
    expect(computeScaleCorrection(landmarks, matrix, ASPECT, 63, null)).toBe(1);
  });
});

describe("depthCrossCheck", () => {
  it("returns ~1 for a consistent iris size", () => {
    const fov = 63;
    const depth = 45;
    const tanHalf = Math.tan(((fov / 2) * Math.PI) / 180);
    const irisNorm = 1.17 / (2 * tanHalf) / depth;
    expect(depthCrossCheck(irisNorm, depth, fov)!).toBeCloseTo(1, 5);
  });

  it("guards zero input", () => {
    expect(depthCrossCheck(0, 45, 63)).toBeNull();
  });
});

describe("refineHeadAnchors", () => {
  it("reproduces the canonical anchors from synthetic canonical landmarks", () => {
    const { landmarks, matrix } = synthesize(63, 45);
    const samples: AnchorSample[] = Array.from({ length: 8 }, () => ({
      landmarks,
      transformMatrix: matrix,
    }));
    const base = canonicalHeadAnchors();
    const refined = refineHeadAnchors(samples, ASPECT, 63, base)!;
    expect(refined).not.toBeNull();
    expect(refined.source).toBe("calibrated");
    // Perfect synthetic data → the measured seat matches canonical closely.
    expect(refined.seatHeadCm.distanceTo(base.seatHeadCm)).toBeLessThan(0.75);
    expect(
      refined.tragionLHeadCm.distanceTo(base.tragionLHeadCm),
    ).toBeLessThan(0.75);
  });

  it("returns null on insufficient samples", () => {
    expect(refineHeadAnchors([], ASPECT, 63, canonicalHeadAnchors())).toBeNull();
  });
});
