import { describe, expect, it } from "vitest";
import { FACE_TRIANGLES, triangleIndices } from "./faceMesh";
import { FRAMES } from "@/data/frames";
import { readFileSync } from "node:fs";

describe("anatomical occlusion topology", () => {
  it("contains the installed 852 canonical triangles, without iris vertices or duplicates", () => {
    expect(FACE_TRIANGLES.length).toBe(852 * 3);
    expect(Math.max(...FACE_TRIANGLES)).toBe(467);
    const triangles = new Set<string>();
    for (let i = 0; i < FACE_TRIANGLES.length; i += 3)
      triangles.add(FACE_TRIANGLES.slice(i, i + 3).sort((a,b) => a-b).join(','));
    expect(triangles.size).toBe(852);
  });
  it("fails explicitly if an SDK update changes edge grouping", () => {
    expect(() => triangleIndices([{start:0,end:1}])).toThrow();
    expect(() => triangleIndices([{start:0,end:1},{start:2,end:3},{start:3,end:0}])).toThrow();
  });
});

describe("catalog lens roles", () => {
  for (const frame of FRAMES) it(`${frame.id} maps to real GLB lens materials`, () => {
    const bytes = readFileSync(`public${frame.glbPath}`);
    const glb = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(frame.fit.lensMaterialNames?.length).toBeGreaterThan(0);
    for (const name of frame.fit.lensMaterialNames!) {
      const material = glb.materials.find((m: {name:string}) => m.name === name);
      expect(material, name).toBeDefined();
      // Transparent either by alpha blending or by glTF transmission
      // (KHR_materials_transmission, e.g. the Khronos sunglasses).
      const transmissive = material.extensions?.KHR_materials_transmission != null;
      expect(material.alphaMode === 'BLEND' || transmissive, name).toBe(true);
    }
  });
});
