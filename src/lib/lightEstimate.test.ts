import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { emaLight, frameStats, mapLightEstimate } from "@/lib/lightEstimate";
import { setEarProxy } from "@/lib/faceOcclusion";

describe("mapLightEstimate", () => {
  it("dim frame → dim rig, bright frame → bright rig", () => {
    const dim = mapLightEstimate([25, 25, 25], 50);
    const bright = mapLightEstimate([180, 180, 180], 240);
    expect(dim.ambient).toBeLessThan(bright.ambient);
    expect(dim.key).toBeLessThan(bright.key);
    expect(dim.ambient).toBeGreaterThanOrEqual(0.2);
    expect(bright.ambient).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(bright.key).toBeLessThanOrEqual(1.2);
  });

  it("warm frame → warm tint, never fully color-cast", () => {
    const warm = mapLightEstimate([200, 150, 100], 220);
    expect(warm.color[0]).toBeGreaterThan(warm.color[2]);
    expect(warm.color[2]).toBeGreaterThanOrEqual(0.5);
  });
});

describe("frameStats", () => {
  it("computes mean and highlight percentile", () => {
    // 8 dark pixels + 2 bright.
    const px: number[] = [];
    for (let i = 0; i < 8; i++) px.push(20, 20, 20, 255);
    for (let i = 0; i < 2; i++) px.push(240, 240, 240, 255);
    const stats = frameStats(new Uint8ClampedArray(px))!;
    expect(stats.meanRgb[0]).toBeCloseTo(64, 0);
    expect(stats.p90Luma).toBeGreaterThan(200);
  });

  it("rejects tiny buffers", () => {
    expect(frameStats(new Uint8ClampedArray([1, 2, 3, 4]))).toBeNull();
  });
});

describe("emaLight", () => {
  it("moves fractionally toward the target", () => {
    const prev = { ambient: 0.2, key: 0.5, color: [1, 1, 1] as [number, number, number] };
    const next = { ambient: 0.6, key: 1.2, color: [0.8, 0.9, 1] as [number, number, number] };
    const out = emaLight(prev, next, 0.25);
    expect(out.ambient).toBeCloseTo(0.3, 6);
    expect(out.key).toBeCloseTo(0.675, 6);
  });
});

describe("setEarProxy", () => {
  it("places symmetric proxies behind and outboard of the cheek junctions", () => {
    const positions = new Float32Array(468 * 3);
    positions[234 * 3] = -0.5;
    positions[234 * 3 + 1] = 0.05;
    positions[234 * 3 + 2] = -0.2;
    positions[454 * 3] = 0.5;
    positions[454 * 3 + 1] = 0.05;
    positions[454 * 3 + 2] = -0.2;
    const pL = new Vector3();
    const sL = new Vector3();
    const pR = new Vector3();
    const sR = new Vector3();
    setEarProxy(positions, "L", pL, sL);
    setEarProxy(positions, "R", pR, sR);
    expect(pL.x).toBeCloseTo(-pR.x, 6);
    expect(pL.y).toBeCloseTo(pR.y, 6);
    expect(pL.z).toBeCloseTo(pR.z, 6);
    // Outboard of the junction and behind it.
    expect(Math.abs(pL.x)).toBeGreaterThan(0.5);
    expect(pL.z).toBeLessThan(-0.2);
    expect(sL.x).toBeGreaterThan(0);
    expect(sL.toArray()).toEqual(sR.toArray());
  });
});
