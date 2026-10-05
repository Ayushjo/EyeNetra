import { describe, expect, it } from "vitest";
import {
  CANONICAL_CM,
  CANONICAL_SELLION,
  canonicalTragion,
  canonicalVec,
} from "@/lib/canonicalFace";

describe("canonicalFace axis conventions", () => {
  it("nose tip (1/4) has the largest +Z (camera-facing)", () => {
    const maxZ = Math.max(...Object.values(CANONICAL_CM).map((v) => v[2]));
    expect(CANONICAL_CM[4][2]).toBeCloseTo(maxZ, 5);
  });

  it("forehead 10 is max Y, chin 152 is min Y", () => {
    const ys = Object.values(CANONICAL_CM).map((v) => v[1]);
    expect(CANONICAL_CM[10][1]).toBeCloseTo(Math.max(...ys), 5);
    expect(CANONICAL_CM[152][1]).toBeCloseTo(Math.min(...ys), 5);
  });

  it("lateral pairs are mirror-symmetric in X", () => {
    for (const [l, r] of [
      [33, 263],
      [133, 362],
      [234, 454],
      [127, 356],
      [93, 323],
    ]) {
      const vl = CANONICAL_CM[l];
      const vr = CANONICAL_CM[r];
      expect(vl[0]).toBeCloseTo(-vr[0], 5);
      expect(vl[1]).toBeCloseTo(vr[1], 5);
      expect(vl[2]).toBeCloseTo(vr[2], 5);
      expect(vl[0]).toBeLessThan(0); // 234-side is -X
    }
  });

  it("head is plausibly face-sized (cm)", () => {
    const width = canonicalVec(454).x - canonicalVec(234).x;
    expect(width).toBeGreaterThan(12);
    expect(width).toBeLessThan(18);
    const height = canonicalVec(10).y - canonicalVec(152).y;
    expect(height).toBeGreaterThan(14);
    expect(height).toBeLessThan(22);
  });
});

describe("derived anchors", () => {
  it("sellion sits on the midline between 168 and 6", () => {
    expect(CANONICAL_SELLION.x).toBeCloseTo(0, 5);
    expect(CANONICAL_SELLION.y).toBeLessThan(CANONICAL_CM[168][1]);
    expect(CANONICAL_SELLION.y).toBeGreaterThan(CANONICAL_CM[6][1] - 1e-6);
    // vertex 6 sits lower and further forward than 168 → blend moves forward
    expect(CANONICAL_SELLION.z).toBeGreaterThan(CANONICAL_CM[168][2] - 1e-6);
    expect(CANONICAL_SELLION.z).toBeLessThan(CANONICAL_CM[6][2] + 1e-6);
  });

  it("tragions are behind and outboard of vertices 234/454, symmetric", () => {
    const l = canonicalTragion("L");
    const r = canonicalTragion("R");
    expect(l.x).toBeCloseTo(-r.x, 5);
    expect(l.y).toBeCloseTo(r.y, 5);
    expect(l.z).toBeCloseTo(r.z, 5);
    expect(l.z).toBeLessThan(CANONICAL_CM[234][2]); // pushed back
    expect(Math.abs(l.x)).toBeGreaterThan(Math.abs(CANONICAL_CM[234][0]));
  });

  it("tragionTune shifts back/up", () => {
    const base = canonicalTragion("R");
    const tuned = canonicalTragion("R", { backCm: 2.2, upCm: 1.2 });
    expect(tuned.z).toBeCloseTo(base.z - 1.0, 5);
    expect(tuned.y).toBeCloseTo(base.y + 1.0, 5);
  });
});
