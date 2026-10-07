import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computePosePerspective } from "./fitPose";
import { canonicalHeadAnchors, DEFAULT_TRAGION_TUNE } from "./headAnchors";

type Fx = { id: string; videoWidth: number; videoHeight: number; landmarks: { x: number; y: number; z: number }[]; transformMatrix: number[] };
// Pose fixtures are synthetic (many landmarks at 0.5,0.5), so eye↔iris
// correspondence is verified live, not here.
const dir = join(process.cwd(), "test-fixtures/pose");
const fixtures: Fx[] = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

describe("near-eye placement for turned heads", () => {
  it("yaw fixtures: pose stays finite and finite with the near-eye blend active", () => {
    for (const fx of fixtures.filter((f) => f.id.startsWith("yaw"))) {
      const pose = computePosePerspective({
        landmarks: fx.landmarks, transformMatrix: fx.transformMatrix, aspect: fx.videoWidth / fx.videoHeight,
        frameWidthMm: 140, scaleTune: 1, yOffsetCm: 0, zOffsetCm: 0,
        headAnchors: canonicalHeadAnchors(DEFAULT_TRAGION_TUNE),
      });
      expect(pose).not.toBeNull();
      expect(Number.isFinite(pose!.position.x)).toBe(true);
    }
  });
});
