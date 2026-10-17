import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CANONICAL_MESH_CM } from "./canonicalFaceMesh";
import { buildHeadLoft, FACE_OVAL, HEAD_LOFT } from "./faceOcclusion";

describe("head loft occluder", () => {
  const { positions, indices } = buildHeadLoft();
  const n = FACE_OVAL.length;
  const pts = Array.from({ length: positions.length / 3 }, (_, i) => new Vector3().fromArray(positions, i * 3));

  it("first ring is exactly the canonical face oval (joins the face mask)", () => {
    FACE_OVAL.forEach((v, k) => {
      expect(pts[k].distanceTo(new Vector3().fromArray(CANONICAL_MESH_CM, v * 3))).toBeLessThan(1e-6);
    });
  });

  it("never wider than the face mask it continues; reaches the back of the head", () => {
    const ovalX = Math.max(...FACE_OVAL.map((v) => Math.abs(CANONICAL_MESH_CM[v * 3])));
    for (const p of pts) expect(Math.abs(p.x)).toBeLessThanOrEqual(ovalX + 1e-6);
    expect(Math.min(...pts.map((p) => p.z))).toBeLessThanOrEqual(HEAD_LOFT.backZ);
  });

  it("is a closed triangle fan/strip over every ring", () => {
    expect(indices.length).toBe(HEAD_LOFT.rings * n * 6 + n * 3);
    expect(Math.max(...indices)).toBe(pts.length - 1);
  });
});
