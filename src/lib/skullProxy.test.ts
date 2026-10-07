import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { canonicalTragion } from "./canonicalFace";
import { skullEllipsoidHeadCm, skullProxyMatrix } from "./faceOcclusion";

const L = canonicalTragion("L");
const R = canonicalTragion("R");
const { center, radii } = skullEllipsoidHeadCm(L, R);
const inside = (p: Vector3) =>
  ((p.x - center.x) / radii.x) ** 2 + ((p.y - center.y) / radii.y) ** 2 + ((p.z - center.z) / radii.z) ** 2 < 1;

describe("skull proxy", () => {
  it("covers the back and top of the head", () => {
    expect(inside(new Vector3(0, L.y + 2, L.z - 6))).toBe(true); // back of head
    expect(inside(new Vector3(0, L.y + 10, L.z))).toBe(true); // crown
  });
  it("leaves the ear points, the eyes and the lens plane outside", () => {
    expect(inside(L)).toBe(false);
    expect(inside(R)).toBe(false);
    expect(inside(new Vector3(-3.2, 2.6, 3.5))).toBe(false); // eye (canthi z ~3.2–3.8)
    expect(inside(new Vector3(0, 2.3, 5.6))).toBe(false); // lens fit point
  });
  it("matrix maps the unit sphere to the ellipsoid (identity head + anchor, mirrored x)", () => {
    const m = skullProxyMatrix(L, R, new Matrix4(), new Matrix4(), new Matrix4());
    const p = new Vector3(0, 0, 1).applyMatrix4(m);
    expect(p.z).toBeCloseTo(center.z + radii.z, 6);
    const q = new Vector3(1, 0, 0).applyMatrix4(m);
    expect(q.x).toBeCloseTo(-(center.x + radii.x), 6);
  });
});
