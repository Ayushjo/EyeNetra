import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  canonicalHeadAnchors,
  decomposeHeadMatrix,
  isFrontalHeadPose,
  solvePantoscopicPitch,
  MAX_PANTOSCOPIC_RAD,
  type GlassesGeom,
} from "@/lib/headAnchors";
import {
  computePosePerspective,
  perspectiveFaceDepth,
  perspectiveHeadDepth,
  PERSPECTIVE_FOV_DEG,
} from "@/lib/fitPose";
import { FRAMES } from "@/data/frames";
import { LENS_AHEAD_OF_PUPIL_CM, LENS_CENTER_BELOW_PUPIL_CM } from "@/lib/canonicalFace";
import type { LandmarkPoint } from "@/store/tryOnStore";

type PoseFixture = {
  id: string;
  videoWidth: number;
  videoHeight: number;
  landmarks: LandmarkPoint[];
  transformMatrix: number[];
};

const fixtureDir = join(process.cwd(), "test-fixtures/pose");
const fixtures: PoseFixture[] = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(fixtureDir, f), "utf8")));

const SAMPLE_GEOM: GlassesGeom = {
  bridgeLocal: { x: 0, y: 0, z: 0 },
  hingeLocal: { x: 0.5, y: 0, z: -0.02 },
};

describe("calibration geometry guards", () => {
  it("accepts the front pose and rejects pronounced yaw/pitch", () => {
    expect(isFrontalHeadPose(fixtures.find((f) => f.id === "front")!.transformMatrix)).toBe(true);
    expect(isFrontalHeadPose(fixtures.find((f) => f.id === "yaw_left_30")!.transformMatrix)).toBe(false);
    expect(isFrontalHeadPose(fixtures.find((f) => f.id === "pitch_down")!.transformMatrix)).toBe(false);
  });

  it("uses landmark 168 depth, not the head-origin depth, for the face surface", () => {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -45, 0, 0, 0, 1];
    expect(perspectiveHeadDepth(matrix)).toBeCloseTo(45, 5);
    expect(perspectiveFaceDepth(matrix)).toBeCloseTo(45 - 5.236015, 5);
  });
});

describe("decomposeHeadMatrix", () => {
  it("rejects null/short matrices", () => {
    const m = new Matrix4();
    expect(decomposeHeadMatrix(null, m)).toBe(false);
    expect(decomposeHeadMatrix([1, 2, 3], m)).toBe(false);
  });

  it("accepts every fixture (rotation-only matrices included)", () => {
    const m = new Matrix4();
    for (const fx of fixtures) {
      expect(decomposeHeadMatrix(fx.transformMatrix, m)).toBe(true);
    }
  });

  it("recovers a metric translation from a row-major matrix", () => {
    const m = new Matrix4();
    const rowMajor = [1, 0, 0, 1.5, 0, 1, 0, 2, 0, 0, 1, -45, 0, 0, 0, 1];
    expect(decomposeHeadMatrix(rowMajor, m)).toBe(true);
    const pos = new Vector3().setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(1.5, 6);
    expect(pos.y).toBeCloseTo(2, 6);
    expect(pos.z).toBeCloseTo(-45, 6);
  });
});

describe("canonical head anchors", () => {
  const anchors = canonicalHeadAnchors();

  it("tragions are behind and lateral to the canthi plane", () => {
    expect(anchors.tragionLHeadCm.z).toBeLessThan(0);
    expect(anchors.tragionRHeadCm.z).toBeLessThan(0);
    expect(Math.abs(anchors.tragionLHeadCm.x)).toBeGreaterThan(6);
    expect(anchors.tragionLHeadCm.x).toBeCloseTo(-anchors.tragionRHeadCm.x, 5);
  });

  it("XY image-lock puts the frame on the observed seat ray at seat depth", () => {
    // Realistic head pose: identity rotation, 45 cm from the camera
    // (row-major translation column = elements 3, 7, 11).
    const matrix = [1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1, -45, 0, 0, 0, 1];
    const landmarks: LandmarkPoint[] = Array.from({ length: 478 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
    }));
    landmarks[168] = { x: 0.52, y: 0.47, z: 0 };
    landmarks[6] = { x: 0.52, y: 0.5, z: 0 };
    landmarks[468] = { x: 0.55, y: 0.47, z: 0 };
    landmarks[473] = { x: 0.45, y: 0.47, z: 0 };
    const aspect = 16 / 9;
    const pose = computePosePerspective({
      landmarks,
      transformMatrix: matrix,
      aspect,
      frameWidthMm: 140,
      scaleTune: 1,
      yOffsetCm: 0,
      zOffsetCm: 0,
      headAnchors: anchors,
    })!;
    expect(pose).not.toBeNull();
    const seatDepth = -pose.position.z;
    // Lens plane sits in front of the head origin.
    expect(seatDepth).toBeGreaterThan(45 - 8);
    expect(seatDepth).toBeLessThan(45 - 2);
    // The ray is cast at the PUPIL depth (lens plane minus vertex distance).
    const pupilDepth = seatDepth + LENS_AHEAD_OF_PUPIL_CM;
    // Re-project the pose position: it must land on the mirrored observed
    // pupil-line ray (iris midpoint), dropped by the lens-centre offset
    // (identity head rotation → straight down in camera space).
    const tanHalf = Math.tan(((PERSPECTIVE_FOV_DEG / 2) * Math.PI) / 180);
    const obsX = (0.55 + 0.45) / 2;
    const obsY = 0.47;
    expect(pose.position.x).toBeCloseTo(
      (0.5 - obsX) * 2 * pupilDepth * tanHalf * aspect,
      6,
    );
    expect(pose.position.y).toBeCloseTo(
      (0.5 - obsY) * 2 * pupilDepth * tanHalf - LENS_CENTER_BELOW_PUPIL_CM,
      6,
    );
  });
});

describe("solvePantoscopicPitch", () => {
  const anchors = canonicalHeadAnchors();

  it("is within the physical pantoscopic range for all SKUs", () => {
    for (const sku of FRAMES) {
      const rad = solvePantoscopicPitch({
        anchors,
        glassesGeom: SAMPLE_GEOM,
        frameWidthMm: sku.fit.frameWidthMm,
        templeLengthMm: sku.fit.templeLengthMm,
      });
      expect(Math.abs(rad)).toBeLessThanOrEqual(MAX_PANTOSCOPIC_RAD + 1e-9);
      // Ears sit below/behind the hinge → temples slope down (negative).
      expect(rad).toBeLessThan(0);
    }
  });

  it("does not depend on head pose (head-local inputs only)", () => {
    const a = solvePantoscopicPitch({
      anchors,
      glassesGeom: SAMPLE_GEOM,
      frameWidthMm: 140,
      templeLengthMm: 140,
    });
    const b = solvePantoscopicPitch({
      anchors: canonicalHeadAnchors(),
      glassesGeom: { ...SAMPLE_GEOM },
      frameWidthMm: 140,
      templeLengthMm: 140,
    });
    expect(a).toBeCloseTo(b, 10);
  });

  it("returns 0 without glasses geometry", () => {
    expect(
      solvePantoscopicPitch({
        anchors,
        glassesGeom: null,
        frameWidthMm: 140,
        templeLengthMm: 140,
      }),
    ).toBe(0);
  });
});

describe("computePosePerspective (anatomical path)", () => {
  const anchors = canonicalHeadAnchors();

  describe("seat vs image-lock contract", () => {
    const front = fixtures.find((f) => f.id === "front")!;
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -45, 0, 0, 0, 1];
    const input = {
      landmarks: front.landmarks, transformMatrix: matrix,
      aspect: front.videoWidth / front.videoHeight,
      frameWidthMm: 140, scaleTune: 1, yOffsetCm: 0, zOffsetCm: 0,
    };
    const calibrated = () => ({
      ...anchors,
      seatHeadCm: anchors.seatHeadCm.clone(),
      source: "calibrated" as const,
    });

    it("calibrated seat X/Y never displaces the frame off the observed landmark ray", () => {
      // The calibrated seat was measured FROM landmarks 168/6, which the
      // per-frame ray already tracks — re-applying its XY would double count.
      const a = calibrated();
      const before = computePosePerspective({ ...input, headAnchors: a })!;
      a.seatHeadCm.x += 0.5;
      a.seatHeadCm.y += 0.5;
      const after = computePosePerspective({ ...input, headAnchors: a })!;
      expect(after.position.x).toBeCloseTo(before.position.x, 6);
      expect(after.position.y).toBeCloseTo(before.position.y, 6);
    });

    it("calibrated seat Z changes the glasses depth", () => {
      const a = calibrated();
      const before = computePosePerspective({ ...input, headAnchors: a })!;
      a.seatHeadCm.z += 0.5; // seat 0.5 cm further toward the camera
      const after = computePosePerspective({ ...input, headAnchors: a })!;
      expect(after.position.z - before.position.z).toBeCloseTo(0.5, 6);
    });

    it("an intentional seat offset moves the frame in full and rotates with the head", () => {
      const a = calibrated();
      const before = computePosePerspective({ ...input, headAnchors: a })!;
      a.seatOffsetHeadCm = new Vector3(0.5, 0.5, 0);
      const after = computePosePerspective({ ...input, headAnchors: a })!;
      // Head +X is mirrored on screen; +Y is up in both.
      expect(after.position.x - before.position.x).toBeCloseTo(-0.5, 6);
      expect(after.position.y - before.position.y).toBeCloseTo(0.5, 6);

      // Under a 30° yaw the same offset is rotated by the head pose.
      const yaw = fixtures.find((f) => f.id === "yaw_left_30")!;
      const m = [...yaw.transformMatrix];
      m[11] = -45;
      const b = calibrated();
      const yawBefore = computePosePerspective({ ...input, transformMatrix: m, headAnchors: b })!;
      b.seatOffsetHeadCm = new Vector3(0, 0, 1); // 1 cm along head forward
      const yawAfter = computePosePerspective({ ...input, transformMatrix: m, headAnchors: b })!;
      const dz = yawAfter.position.z - yawBefore.position.z;
      const dx = yawAfter.position.x - yawBefore.position.x;
      expect(Math.hypot(dx, dz)).toBeCloseTo(1, 5);
      expect(Math.abs(dz)).toBeCloseTo(Math.cos(Math.PI / 6), 2);
    });
  });

  it("produces a finite, depth-consistent pose on every fixture", () => {
    for (const fx of fixtures) {
      const aspect = fx.videoWidth / fx.videoHeight;
      const depth = perspectiveHeadDepth(fx.transformMatrix)!;
      const pose = computePosePerspective({
        landmarks: fx.landmarks,
        transformMatrix: fx.transformMatrix,
        aspect,
        frameWidthMm: 140,
        nosePadOffsetMm: 2,
        scaleTune: 1,
        yOffsetCm: 0,
        zOffsetCm: 0,
        headAnchors: anchors,
        pantoRad: -0.1,
      });
      expect(pose).not.toBeNull();
      const p = pose!;
      expect(Number.isFinite(p.position.x)).toBe(true);
      expect(Number.isFinite(p.position.y)).toBe(true);
      // Seat depth stays near the head depth (seat is ~5-7cm in front).
      expect(-p.position.z).toBeGreaterThan(depth * 0.7);
      expect(-p.position.z).toBeLessThan(depth * 1.1);
      expect(p.quaternion.length()).toBeCloseTo(1, 5);
      // True physical width in cm.
      expect(p.scale).toBeCloseTo(14, 5);
    }
  });

  it("scaleCorrection scales the physical width linearly", () => {
    const fx = fixtures.find((f) => f.id === "front")!;
    const aspect = fx.videoWidth / fx.videoHeight;
    const base = computePosePerspective({
      landmarks: fx.landmarks,
      transformMatrix: fx.transformMatrix,
      aspect,
      frameWidthMm: 140,
      scaleTune: 1,
      yOffsetCm: 0,
      zOffsetCm: 0,
      headAnchors: anchors,
      scaleCorrection: 1.1,
    })!;
    expect(base.scale).toBeCloseTo(15.4, 5);
  });

  it("pantoscopic pitch changes rotation but not scale", () => {
    const fx = fixtures.find((f) => f.id === "front")!;
    const aspect = fx.videoWidth / fx.videoHeight;
    const mk = (panto: number) =>
      computePosePerspective({
        landmarks: fx.landmarks,
        transformMatrix: fx.transformMatrix,
        aspect,
        frameWidthMm: 140,
        scaleTune: 1,
        yOffsetCm: 0,
        zOffsetCm: 0,
        headAnchors: anchors,
        pantoRad: panto,
      })!;
    const q0 = mk(0);
    const q1 = mk(-0.15);
    expect(q0.scale).toBeCloseTo(q1.scale, 8);
    const angle = new Quaternion()
      .copy(q0.quaternion)
      .invert()
      .multiply(q1.quaternion);
    expect(2 * Math.acos(Math.min(1, Math.abs(angle.w)))).toBeCloseTo(0.15, 3);
  });
});
