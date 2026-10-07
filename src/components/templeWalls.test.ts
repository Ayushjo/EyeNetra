import { describe, expect, it } from "vitest";
import { buildTempleWalls } from "./GlassesModel";

// Straight temples at |x| = 0.5 from z −0.06 back to −1.0, y = 0.05.
function deform() {
  const mk = (sgn: 1 | -1) => {
    const m = new Map<number, { sum: number; sumY: number; n: number }>();
    for (let k = 3; k <= 50; k++) m.set(k, { sum: sgn * 0.5, sumY: 0.05, n: 1 });
    return m;
  };
  return { entries: [], binsPos: mk(1), binsNeg: mk(-1) };
}

describe("buildTempleWalls", () => {
  it("puts a wall just inside each temple (medial), never outside it", () => {
    const g = buildTempleWalls(deform(), { x: 0.5, z: -0.05 }, { pos: 0, neg: 0 })!;
    const p = g.getAttribute("position");
    let n = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      expect(Math.abs(x)).toBeLessThan(0.5);
      expect(Math.abs(x)).toBeGreaterThan(0.47);
      expect(p.getZ(i)).toBeLessThan(-0.05);
      n++;
    }
    expect(n).toBeGreaterThan(40);
  });

  it("follows the temple fold", () => {
    const g = buildTempleWalls(deform(), { x: 0.5, z: -0.05 }, { pos: -0.1, neg: 0.1 })!;
    const p = g.getAttribute("position");
    let maxX = 0;
    for (let i = 0; i < p.count; i++) maxX = Math.max(maxX, p.getX(i));
    // Outward fold of ~5.7° over ~0.9 widths moves the far end out ~0.09.
    expect(maxX).toBeGreaterThan(0.55);
  });
});
