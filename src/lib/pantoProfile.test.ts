import { describe, expect, it } from "vitest";
import {
  canonicalHeadAnchors,
  DEFAULT_TRAGION_TUNE,
  earInGlassesSpace,
  MAX_PANTOSCOPIC_RAD,
  solvePantoscopicPitch,
  templeAt,
  type GlassesGeom,
} from "./headAnchors";

const anchors = canonicalHeadAnchors(DEFAULT_TRAGION_TUNE);
const hinge = { x: 0.48, y: 0.06, z: -0.08 };
/** Temple from the hinge back to z = −1, dropping `dropPerUnit` in y per unit of −z. */
function profile(dropPerUnit: number) {
  const z: number[] = [], x: number[] = [], y: number[] = [];
  for (let zz = hinge.z; zz >= -1; zz -= 0.02) {
    z.push(zz);
    x.push(hinge.x);
    y.push(hinge.y - dropPerUnit * (hinge.z - zz));
  }
  return { z, x, y };
}
const geom = (dropPerUnit: number): GlassesGeom => ({
  bridgeLocal: { x: 0, y: 0, z: 0 },
  hingeLocal: hinge,
  templeProfile: profile(dropPerUnit),
});
const scaleCm = 14;

describe("pantoscopic tilt from the authored temple", () => {
  it("side-on: after tilting, the temple passes through the ear-rest point", () => {
    // drop 0 would need > 15° and is clamped (asserted below); these converge.
    for (const drop of [0.1, 0.2, 0.3]) {
      const g = geom(drop);
      const alpha = solvePantoscopicPitch({ anchors, glassesGeom: g, frameWidthMm: 140, templeLengthMm: 145, scaleCm });
      expect(Math.abs(alpha)).toBeLessThan(MAX_PANTOSCOPIC_RAD);
      for (const sgn of [1, -1] as const) {
        const ear = earInGlassesSpace(anchors, sgn, scaleCm, alpha);
        const t = templeAt(g.templeProfile, ear.z)!;
        expect(t).not.toBeNull();
        // Within 1 mm at a 14 cm frame.
        expect(Math.abs(t.y - ear.y) * scaleCm).toBeLessThan(0.1);
      }
    }
  });

  it("clamps to ±15° when the ear is out of reach", () => {
    const a = solvePantoscopicPitch({ anchors, glassesGeom: geom(0), frameWidthMm: 140, templeLengthMm: 145, scaleCm });
    expect(Math.abs(a)).toBeCloseTo(MAX_PANTOSCOPIC_RAD, 9);
  });

  it("a temple modelled sloping down needs less tilt than a straight one", () => {
    const straight = solvePantoscopicPitch({ anchors, glassesGeom: geom(0), frameWidthMm: 140, templeLengthMm: 145, scaleCm });
    const sloped = solvePantoscopicPitch({ anchors, glassesGeom: geom(0.15), frameWidthMm: 140, templeLengthMm: 145, scaleCm });
    // Rotation +α tips temples UP; a pre-sloped temple needs α larger (less negative).
    expect(sloped).toBeGreaterThan(straight);
  });

  it("templeAt interpolates and returns null outside the temple", () => {
    const p = profile(0);
    expect(templeAt(p, -0.5)!.x).toBeCloseTo(hinge.x, 6);
    expect(templeAt(p, 0.2)).toBeNull();
    expect(templeAt(p, -1.5)).toBeNull();
  });
});
