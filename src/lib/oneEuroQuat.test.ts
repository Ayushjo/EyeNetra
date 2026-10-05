import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { OneEuroQuat } from "@/lib/oneEuro";
import { predictPose, PREDICT_MAX_STEP_RAD } from "@/lib/posePredict";

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

function q(axis: Vector3, deg: number): [number, number, number, number] {
  const quat = new Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);
  return [quat.x, quat.y, quat.z, quat.w];
}

describe("OneEuroQuat", () => {
  it("passes constant input through unchanged and unit-norm", () => {
    const f = new OneEuroQuat();
    const raw = q(Y, 25);
    const out = [0, 0, 0, 1];
    for (let i = 0; i < 60; i++) f.filter(i / 60, raw, out);
    expect(Math.hypot(out[0], out[1], out[2], out[3])).toBeCloseTo(1, 10);
    expect(out[0]).toBeCloseTo(raw[0], 6);
    expect(out[3]).toBeCloseTo(raw[3], 6);
  });

  it("stays continuous across a hemisphere sign flip", () => {
    const f = new OneEuroQuat(2, 0.5);
    const out = [0, 0, 0, 1];
    const raw = q(Y, 30);
    f.filter(0, raw, out);
    const before = [...out];
    // Same rotation, negated representation.
    f.filter(1 / 60, [-raw[0], -raw[1], -raw[2], -raw[3]], out);
    const dot =
      before[0] * out[0] + before[1] * out[1] + before[2] * out[2] + before[3] * out[3];
    expect(Math.abs(dot)).toBeGreaterThan(0.9999);
  });

  it("converges to a step input", () => {
    const f = new OneEuroQuat(2, 0.5);
    const out = [0, 0, 0, 1];
    f.filter(0, q(Y, 0), out);
    const target = q(Y, 40);
    for (let i = 1; i <= 120; i++) f.filter(i / 60, target, out);
    const outQ = new Quaternion(out[0], out[1], out[2], out[3]);
    const tgtQ = new Quaternion(target[0], target[1], target[2], target[3]);
    expect(Math.abs(outQ.dot(tgtQ))).toBeGreaterThan(0.99999);
  });

  it("always outputs unit quaternions during motion", () => {
    const f = new OneEuroQuat();
    const out = [0, 0, 0, 1];
    for (let i = 0; i <= 90; i++) {
      f.filter(i / 60, q(Y, i), out);
      expect(Math.hypot(out[0], out[1], out[2], out[3])).toBeCloseTo(1, 8);
    }
  });
});

describe("predictPose", () => {
  it("extrapolates position linearly", () => {
    const outPos = new Vector3(2, 0, 0);
    const outQuat = new Quaternion();
    predictPose(
      new Vector3(0, 0, 0),
      new Quaternion(),
      0,
      new Vector3(1, 0, 0),
      new Quaternion(),
      33,
      16.5,
      outPos,
      outQuat,
    );
    expect(outPos.x).toBeCloseTo(2.5, 6);
  });

  it("clamps the rotation step", () => {
    const q0 = new Quaternion();
    const q1 = new Quaternion().setFromAxisAngle(X, 0.5); // huge inter-frame turn
    const outQuat = new Quaternion();
    predictPose(
      new Vector3(),
      q0,
      0,
      new Vector3(),
      q1,
      33,
      33,
      new Vector3(),
      outQuat,
    );
    const angle = 2 * Math.acos(Math.min(1, Math.abs(outQuat.w)));
    expect(angle).toBeLessThanOrEqual(PREDICT_MAX_STEP_RAD + 1e-9);
  });

  it("no-ops on zero horizon or degenerate dt", () => {
    const outPos = new Vector3(1, 1, 1);
    const outQuat = new Quaternion();
    predictPose(
      new Vector3(),
      new Quaternion(),
      0,
      new Vector3(9, 9, 9),
      new Quaternion(),
      0.5,
      33,
      outPos,
      outQuat,
    );
    expect(outPos.x).toBe(1);
    predictPose(
      new Vector3(),
      new Quaternion(),
      0,
      new Vector3(9, 9, 9),
      new Quaternion(),
      33,
      0,
      outPos,
      outQuat,
    );
    expect(outPos.x).toBe(1);
  });
});
