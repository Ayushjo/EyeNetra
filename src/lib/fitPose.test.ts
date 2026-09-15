import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Euler } from "three";
import { describe, expect, it } from "vitest";
import { computePose } from "./fitPose";
import type { LandmarkPoint } from "@/store/tryOnStore";

type PoseFixture = {
  id: string;
  videoWidth: number;
  videoHeight: number;
  landmarks: LandmarkPoint[];
  transformMatrix: number[];
  expect: {
    yawSign: -1 | 0 | 1;
    yawAbsDegMin?: number;
    yawAbsDegMax?: number;
    pitchSign?: -1 | 0 | 1;
    pitchAbsDegMin?: number;
    scaleMin: number;
    scaleMax: number;
  };
};

const fixtureDir = join(process.cwd(), "test-fixtures/pose");

function loadFixtures(): PoseFixture[] {
  return readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) =>
      JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) as PoseFixture,
    );
}

describe("computePose fixtures", () => {
  const fixtures = loadFixtures();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  it("loads all five required pose fixtures", () => {
    expect(fixtures.map((f) => f.id).sort()).toEqual(
      ["close", "front", "pitch_down", "yaw_left_30", "yaw_right_30"].sort(),
    );
  });

  for (const fixture of fixtures) {
    it(`${fixture.id}: finite pose, scale in bounds, yaw/pitch direction`, () => {
      const aspect =
        fixture.videoHeight > 0
          ? fixture.videoWidth / fixture.videoHeight
          : 16 / 9;
      const pose = computePose({
        landmarks: fixture.landmarks,
        transformMatrix: fixture.transformMatrix,
        aspect,
        scaleMul: 1.4,
        yOffsetFrac: 0.035,
        frameWidthMm: 138,
        faceProfile: null,
      });

      expect(pose).not.toBeNull();
      if (!pose) return;

      expect(Number.isFinite(pose.position.x)).toBe(true);
      expect(Number.isFinite(pose.position.y)).toBe(true);
      expect(Number.isFinite(pose.position.z)).toBe(true);
      expect(Number.isFinite(pose.scale)).toBe(true);
      expect(pose.scale).not.toBe(0);
      expect(pose.scale).toBeGreaterThanOrEqual(fixture.expect.scaleMin);
      expect(pose.scale).toBeLessThanOrEqual(fixture.expect.scaleMax);
      expect(Number.isFinite(pose.quaternion.w)).toBe(true);

      const euler = new Euler().setFromQuaternion(pose.quaternion, "YXZ");
      const yawDeg = (euler.y * 180) / Math.PI;
      const pitchDeg = (euler.x * 180) / Math.PI;

      if (fixture.expect.yawSign === 0) {
        expect(Math.abs(yawDeg)).toBeLessThanOrEqual(
          fixture.expect.yawAbsDegMax ?? 15,
        );
      } else {
        expect(Math.sign(yawDeg) || Math.sign(yawDeg)).toBe(
          fixture.expect.yawSign,
        );
        // Prefer non-zero magnitude window
        expect(Math.abs(yawDeg)).toBeGreaterThanOrEqual(
          fixture.expect.yawAbsDegMin ?? 12,
        );
        expect(Math.abs(yawDeg)).toBeLessThanOrEqual(
          fixture.expect.yawAbsDegMax ?? 55,
        );
      }

      if (fixture.expect.pitchSign && fixture.expect.pitchAbsDegMin) {
        expect(Math.sign(pitchDeg)).toBe(fixture.expect.pitchSign);
        expect(Math.abs(pitchDeg)).toBeGreaterThanOrEqual(
          fixture.expect.pitchAbsDegMin,
        );
      }
    });
  }

  it("close has larger live scale than front", () => {
    const front = byId.front;
    const close = byId.close;
    const run = (f: PoseFixture) =>
      computePose({
        landmarks: f.landmarks,
        transformMatrix: f.transformMatrix,
        aspect: f.videoWidth / f.videoHeight,
        scaleMul: 1.4,
        yOffsetFrac: 0.035,
        frameWidthMm: 138,
        faceProfile: null,
      })!;

    expect(run(close).scale).toBeGreaterThan(run(front).scale);
  });

  it("calib scale floors at 0.55× live when profile is too small", () => {
    const front = byId.front;
    const pose = computePose({
      landmarks: front.landmarks,
      transformMatrix: front.transformMatrix,
      aspect: front.videoWidth / front.videoHeight,
      scaleMul: 1.4,
      yOffsetFrac: 0.035,
      frameWidthMm: 138,
      faceProfile: {
        ipdMm: 63,
        faceWidthMm: 500,
        refEyeSpanScene: 0.05,
        capturedAt: Date.now(),
      },
    });
    expect(pose).not.toBeNull();
    if (!pose) return;
    expect(pose.calibScale).not.toBeNull();
    expect(pose.scale).toBeGreaterThanOrEqual(pose.liveScale * 0.55 - 1e-6);
  });

  it("calib path ignores scaleMul (mm-only; scaleMul blew up size)", () => {
    const front = byId.front;
    const profile = {
      ipdMm: 60,
      faceWidthMm: 90,
      refEyeSpanScene: 0.4,
      capturedAt: Date.now(),
    };
    const without = computePose({
      landmarks: front.landmarks,
      transformMatrix: front.transformMatrix,
      aspect: front.videoWidth / front.videoHeight,
      scaleMul: 1,
      yOffsetFrac: 0,
      frameWidthMm: 140,
      faceProfile: profile,
    })!;
    const withMul = computePose({
      landmarks: front.landmarks,
      transformMatrix: front.transformMatrix,
      aspect: front.videoWidth / front.videoHeight,
      scaleMul: 1.35,
      yOffsetFrac: 0,
      frameWidthMm: 140,
      faceProfile: profile,
    })!;
    expect(withMul.scale).toBeCloseTo(without.scale, 5);
  });

  it("position stays near mid-eyes (landmark-only XY, in ortho frustum)", () => {
    const front = byId.front;
    const aspect = front.videoWidth / front.videoHeight;
    const pose = computePose({
      landmarks: front.landmarks,
      transformMatrix: front.transformMatrix,
      aspect,
      scaleMul: 1.4,
      yOffsetFrac: 0,
      frameWidthMm: 138,
      faceProfile: null,
    });
    expect(pose).not.toBeNull();
    if (!pose) return;
    // Must stay inside ortho frustum (x ∈ ±aspect, y ∈ ±1) — matrix embed
    // previously pushed y≈3.8 and hid the frames off-screen.
    expect(Math.abs(pose.position.x)).toBeLessThan(aspect);
    expect(Math.abs(pose.position.y)).toBeLessThan(1);
    expect(pose.position.z).toBeCloseTo(0.12, 5);
  });
});
