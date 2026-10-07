import { describe, expect, it } from "vitest";
import { canonicalHeadAnchors, DEFAULT_TRAGION_TUNE, MAX_TEMPLE_FOLD_RAD, solveTempleFold } from "./headAnchors";

const anchors = canonicalHeadAnchors(DEFAULT_TRAGION_TUNE);
// Typical 140 mm frame: hinges at ±0.5, temples straight back 0.95 width.
/** Straight temple from the hinge (±0.5, z −0.05) to (±tipX, −1). */
const line = (tipX: number) => (side: 1 | -1, z: number) =>
  z < -1 ? null : side * (0.5 + ((tipX - 0.5) * (-0.05 - z)) / 0.95);
const base = { anchors, hinge: { x: 0.5, y: 0, z: -0.05 }, scaleCm: 14, pantoRad: -0.15 };

describe("solveTempleFold", () => {
  it("symmetric head + symmetric frame → mirror-symmetric fold", () => {
    const f = solveTempleFold({ ...base, templeXAt: line(0.5) });
    expect(f.pos).toBeCloseTo(-f.neg, 6);
  });

  it("splayed temples fold inward relative to straight ones", () => {
    const straight = solveTempleFold({ ...base, templeXAt: line(0.5) });
    const splayed = solveTempleFold({ ...base, templeXAt: line(0.6) });
    // Rotation about +Y: positive angle swings a −Z temple toward −X.
    expect(splayed.pos).toBeGreaterThan(straight.pos);
    expect(splayed.neg).toBeLessThan(straight.neg);
  });

  it("a wider frame on the same head folds the temples inward", () => {
    const narrow = solveTempleFold({ ...base, scaleCm: 12, templeXAt: line(0.5) });
    const wide = solveTempleFold({ ...base, scaleCm: 16, templeXAt: line(0.5) });
    expect(wide.pos).toBeGreaterThan(narrow.pos);
  });

  it("clamps to ±20° and is 0 for a degenerate scale", () => {
    const f = solveTempleFold({ ...base, templeXAt: line(3) });
    expect(Math.abs(f.pos)).toBeLessThanOrEqual(MAX_TEMPLE_FOLD_RAD + 1e-9);
    expect(solveTempleFold({ ...base, scaleCm: 0, templeXAt: line(0.5) })).toEqual({ pos: 0, neg: 0 });
  });
});

describe("solveTempleFold aims the arm, not a hooked tip", () => {
  it("a tip that curls inward past the ear does not swing the arm outward", () => {
    const straight = (side: 1 | -1, z: number) => (z < -1 ? null : side * 0.5);
    const hooked = (side: 1 | -1, z: number) => (z < -1 ? null : side * (z < -0.85 ? 0.42 : 0.5));
    const a = solveTempleFold({ ...base, templeXAt: straight });
    const b = solveTempleFold({ ...base, templeXAt: hooked });
    expect(b.pos).toBeCloseTo(a.pos, 6);
  });
});
