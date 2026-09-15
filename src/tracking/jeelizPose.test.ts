import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Euler, Quaternion } from "three";
import { describe, expect, it } from "vitest";
import {
  jeelizDetectToFrame,
  type JeelizDetectState,
} from "@/tracking/jeelizPose";

type JeelizFixture = {
  id: string;
  videoWidth: number;
  videoHeight: number;
  detect: JeelizDetectState;
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

const fixtureDir = join(process.cwd(), "test-fixtures/pose/jeeliz");

function loadFixtures(): JeelizFixture[] {
  return readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) =>
        JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) as JeelizFixture,
    );
}

describe("JeelizProvider pose (jeelizDetectToFrame)", () => {
  const fixtures = loadFixtures();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  it("loads five Jeeliz fixtures", () => {
    expect(fixtures.map((f) => f.id).sort()).toEqual(
      ["close", "front", "pitch_down", "yaw_left_30", "yaw_right_30"].sort(),
    );
  });

  for (const fixture of fixtures) {
    it(`${fixture.id}: shape, scale bounds, yaw/pitch direction`, () => {
      const frame = jeelizDetectToFrame({
        detect: fixture.detect,
        videoWidth: fixture.videoWidth,
        videoHeight: fixture.videoHeight,
        scaleMul: 1.4,
        yOffsetFrac: 0.035,
        frameWidthMm: 138,
        faceProfile: null,
      });

      expect(frame.hasFace).toBe(true);
      expect(frame.landmarks).toBeUndefined();
      expect(Number.isFinite(frame.position.x)).toBe(true);
      expect(Number.isFinite(frame.scale)).toBe(true);
      expect(frame.scale).not.toBe(0);
      expect(frame.scale).toBeGreaterThanOrEqual(fixture.expect.scaleMin);
      expect(frame.scale).toBeLessThanOrEqual(fixture.expect.scaleMax);

      const q = new Quaternion(
        frame.rotation.x,
        frame.rotation.y,
        frame.rotation.z,
        frame.rotation.w,
      );
      const euler = new Euler().setFromQuaternion(q, "YXZ");
      const yawDeg = (euler.y * 180) / Math.PI;
      const pitchDeg = (euler.x * 180) / Math.PI;

      if (fixture.expect.yawSign === 0) {
        expect(Math.abs(yawDeg)).toBeLessThanOrEqual(
          fixture.expect.yawAbsDegMax ?? 15,
        );
      } else {
        expect(Math.sign(yawDeg)).toBe(fixture.expect.yawSign);
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

  it("close has larger scale than front", () => {
    const run = (f: JeelizFixture) =>
      jeelizDetectToFrame({
        detect: f.detect,
        videoWidth: f.videoWidth,
        videoHeight: f.videoHeight,
        scaleMul: 1.4,
        yOffsetFrac: 0.035,
        frameWidthMm: 138,
        faceProfile: null,
      });
    expect(run(byId.close).scale).toBeGreaterThan(run(byId.front).scale);
  });

  it("scaleBind matches MediaPipe at sRef and scales with s", () => {
    const front = byId.front;
    const scale0 = 0.72;
    const sRef = front.detect.s;
    const atBind = jeelizDetectToFrame({
      detect: front.detect,
      videoWidth: front.videoWidth,
      videoHeight: front.videoHeight,
      scaleMul: 1.4,
      yOffsetFrac: 0.035,
      frameWidthMm: 138,
      faceProfile: null,
      scaleBind: { scale0, sRef },
    });
    expect(atBind.scale).toBeCloseTo(scale0, 5);

    const closer = jeelizDetectToFrame({
      detect: { ...front.detect, s: sRef * 1.5 },
      videoWidth: front.videoWidth,
      videoHeight: front.videoHeight,
      scaleMul: 1.4,
      yOffsetFrac: 0.035,
      frameWidthMm: 138,
      faceProfile: null,
      scaleBind: { scale0, sRef },
    });
    expect(closer.scale).toBeCloseTo(scale0 * 1.5, 5);
  });

  it("holdScale freezes size before bind", () => {
    const front = byId.front;
    const frame = jeelizDetectToFrame({
      detect: front.detect,
      videoWidth: front.videoWidth,
      videoHeight: front.videoHeight,
      scaleMul: 1.4,
      yOffsetFrac: 0.035,
      frameWidthMm: 138,
      faceProfile: null,
      holdScale: 0.81,
    });
    expect(frame.scale).toBe(0.81);
    expect(frame.calibScale).toBe(0.81);
  });
});
