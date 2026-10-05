import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTrackingFrame } from "@/tracking/buildTrackingFrame";
import { canonicalHeadAnchors } from "@/lib/headAnchors";
import { FRAMES } from "@/data/frames";
import type { LandmarkPoint } from "@/store/tryOnStore";

const fx = JSON.parse(
  readFileSync(join(process.cwd(), "test-fixtures/pose/front.json"), "utf8"),
) as {
  videoWidth: number;
  videoHeight: number;
  landmarks: LandmarkPoint[];
  transformMatrix: number[];
};

const baseInput = {
  landmarks: fx.landmarks,
  transformMatrix: fx.transformMatrix,
  videoWidth: fx.videoWidth,
  videoHeight: fx.videoHeight,
  timestampMs: 1234.5,
  detectedAtMs: 999,
  sku: FRAMES[0],
  faceProfile: null,
  headAnchors: canonicalHeadAnchors(),
  glassesGeom: null,
  perspTune: { yOffsetCm: 0, zOffsetCm: 0, scaleTune: 1 },
};

describe("buildTrackingFrame", () => {
  it("computes both poses and carries timestamps", () => {
    const frame = buildTrackingFrame(baseInput);
    expect(frame.hasFace).toBe(true);
    expect(frame.timestampMs).toBe(1234.5);
    expect(frame.detectedAtMs).toBe(999);
    // Ortho pose (legacy) present.
    expect(Number.isFinite(frame.position.x)).toBe(true);
    // Perspective anatomical pose present with true physical width (cm).
    expect(frame.anchorPose).not.toBeNull();
    expect(frame.anchorPose!.scale).toBeCloseTo(
      FRAMES[0].fit.frameWidthMm / 10,
      5,
    );
    expect(frame.depthCm).toBeGreaterThan(5);
  });

  it("returns a no-face frame without landmarks or matrix", () => {
    const a = buildTrackingFrame({ ...baseInput, landmarks: null });
    expect(a.hasFace).toBe(false);
    expect(a.anchorPose).toBeNull();
    const b = buildTrackingFrame({ ...baseInput, transformMatrix: null });
    expect(b.hasFace).toBe(false);
  });
});
