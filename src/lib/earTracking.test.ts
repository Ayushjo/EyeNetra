import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { earRay, sideVisible, triangulateWithPrior } from "./earTracking";

const tanHalf = Math.tan((63 * Math.PI) / 360);
const aspect = 16 / 9;

/** Head pose: yaw (deg) about Y, 45 cm in front of the camera. */
function head(yawDeg: number) {
  return new Matrix4().compose(
    new Vector3(0, 0, -45),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (yawDeg * Math.PI) / 180),
    new Vector3(1, 1, 1),
  );
}
/** Project a head-local point to normalized image coords (unmirrored). */
function project(p: Vector3, m: Matrix4) {
  const c = p.clone().applyMatrix4(m);
  const d = -c.z;
  return { x: c.x / (2 * d * tanHalf * aspect) + 0.5, y: 0.5 - c.y / (2 * d * tanHalf) };
}

const truth = new Vector3(-7.4, 0.9, -3.1); // the user's real ear junction
const prior = new Vector3(-7.66, 0.67, -2.44); // canonical 234

describe("ear triangulation", () => {
  it("recovers the full 3D point (incl. depth) when the head turns", () => {
    const rays = [-35, -20, -5, 0, 10].map((yaw) => {
      const m = head(yaw);
      return earRay(project(truth, m), m, aspect, tanHalf)!;
    });
    const p = triangulateWithPrior(rays, prior, 0.002);
    expect(p.distanceTo(truth)).toBeLessThan(0.05);
  });

  it("frontal-only views fix x/y but leave depth at the prior", () => {
    const rays = [0, 0.5, -0.5].map((yaw) => {
      const m = head(yaw);
      return earRay(project(truth, m), m, aspect, tanHalf)!;
    });
    const p = triangulateWithPrior(rays, prior, 0.002);
    expect(Math.abs(p.x - truth.x)).toBeLessThan(0.15);
    expect(Math.abs(p.y - truth.y)).toBeLessThan(0.15);
    // Depth barely moves from the prior (weakly observed from the front).
    expect(Math.abs(p.z - prior.z)).toBeLessThan(Math.abs(truth.z - prior.z));
  });

  it("no rays → the prior", () => {
    expect(triangulateWithPrior([], prior).distanceTo(prior)).toBeLessThan(1e-9);
  });

  it("visibility: a side turned away from the camera is rejected", () => {
    // Positive yaw turns head −x toward the camera? Check both signs explicitly.
    const towards = earRay(project(truth, head(-30)), head(-30), aspect, tanHalf)!;
    const away = earRay(project(truth, head(30)), head(30), aspect, tanHalf)!;
    const visL = [sideVisible(towards, -1), sideVisible(away, -1)];
    // Exactly one of the two poses shows the −x side.
    expect(visL[0] !== visL[1]).toBe(true);
    expect(sideVisible(earRay(project(truth, head(0)), head(0), aspect, tanHalf)!, -1)).toBe(true);
  });
});
