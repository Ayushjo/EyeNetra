import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CANONICAL_MESH_CM } from "./canonicalFaceMesh";
import { solveHeadPosePnP } from "./pnp";

const W = 1280, H = 720, FOV = 63;
const f = H / 2 / Math.tan((FOV / 2) * Math.PI / 180);

/** Synthetic landmarks: canonical mesh posed by m, projected with the same pinhole. */
function project(m: Matrix4, noisePx = 0, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < 468; i++) {
    const p = new Vector3(CANONICAL_MESH_CM[i * 3], CANONICAL_MESH_CM[i * 3 + 1], CANONICAL_MESH_CM[i * 3 + 2]).applyMatrix4(m);
    const z = -p.z;
    out.push({ x: (W / 2 + (f * p.x) / z + noisePx * rnd()) / W, y: (H / 2 - (f * p.y) / z + noisePx * rnd()) / H });
  }
  return out;
}

function pose(yawDeg: number, pitchDeg: number, rollDeg: number, t: [number, number, number]) {
  const q = new Quaternion().setFromEuler(new Euler(pitchDeg * Math.PI / 180, yawDeg * Math.PI / 180, rollDeg * Math.PI / 180, "YXZ"));
  return new Matrix4().compose(new Vector3(...t), q, new Vector3(1, 1, 1));
}

function angleBetween(a: Matrix4, b: Matrix4) {
  const qa = new Quaternion().setFromRotationMatrix(a), qb = new Quaternion().setFromRotationMatrix(b);
  return (qa.angleTo(qb) * 180) / Math.PI;
}

describe("solveHeadPosePnP", () => {
  for (const [name, truth] of [
    ["frontal", pose(0, 0, 0, [0, 0, -45])],
    ["yaw 35", pose(35, -5, 3, [4, -2, -50])],
    ["pitch down", pose(-8, 15, -4, [-3, 3, -38])],
  ] as const) {
    it(`${name}: recovers pose from a perturbed initial guess (exact landmarks)`, () => {
      const init = truth.clone().multiply(pose(6, -4, 3, [0, 0, 0])).setPosition(new Vector3().setFromMatrixPosition(truth).add(new Vector3(1.5, -1, 4)));
      const res = solveHeadPosePnP(project(truth), init.toArray() as number[], W, H, FOV)!;
      expect(res).not.toBeNull();
      const got = new Matrix4().fromArray(res.matrix);
      expect(angleBetween(got, truth)).toBeLessThan(0.05);
      expect(new Vector3().setFromMatrixPosition(got).distanceTo(new Vector3().setFromMatrixPosition(truth))).toBeLessThan(0.02);
      expect(res.rmsPx).toBeLessThan(0.01);
    });
  }

  it("1 px landmark noise: rotation within 1°, depth within 1 cm, rms ≈ noise", () => {
    const truth = pose(20, 5, -2, [2, 1, -48]);
    const res = solveHeadPosePnP(project(truth, 1), truth.toArray() as number[], W, H, FOV)!;
    const got = new Matrix4().fromArray(res.matrix);
    expect(angleBetween(got, truth)).toBeLessThan(1);
    expect(Math.abs(new Vector3().setFromMatrixPosition(got).z - -48)).toBeLessThan(1);
    expect(res.rmsPx).toBeLessThan(1.2);
  });

  it("drops a uniform scale in the initial matrix and rejects bad input", () => {
    const truth = pose(0, 0, 0, [0, 0, -45]);
    const scaled = truth.clone().scale(new Vector3(1.1, 1.1, 1.1));
    const res = solveHeadPosePnP(project(truth), scaled.toArray() as number[], W, H, FOV)!;
    expect(res.rmsPx).toBeLessThan(0.01);
    expect(solveHeadPosePnP([], truth.toArray() as number[], W, H, FOV)).toBeNull();
    expect(solveHeadPosePnP(project(truth), null, W, H, FOV)).toBeNull();
  });
});
