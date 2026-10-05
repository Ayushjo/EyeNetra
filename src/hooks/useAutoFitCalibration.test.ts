import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAutoCalibSample } from "@/hooks/useAutoFitCalibration";
import type { LandmarkPoint } from "@/store/tryOnStore";

const load = (id: string) =>
  JSON.parse(readFileSync(join(process.cwd(), `test-fixtures/pose/${id}.json`), "utf8")) as {
    videoWidth: number; videoHeight: number; landmarks: LandmarkPoint[]; transformMatrix: number[];
  };

function frame(id: string, over: Partial<{ depthCm: number; timestampMs: number; hasFace: boolean }> = {}) {
  const f = load(id);
  const m = [...f.transformMatrix];
  m[11] = -45; // row-major translation column → 45 cm
  return {
    hasFace: true, landmarks: f.landmarks, transformMatrix: m, timestampMs: 1000,
    depthCm: 40, videoWidth: f.videoWidth, videoHeight: f.videoHeight, ...over,
  };
}

describe("evaluateAutoCalibSample gates", () => {
  it("rejects missing face, stale detections, bad depth and yawed heads", () => {
    expect(evaluateAutoCalibSample(null, 0)).toBe("no-face");
    expect(evaluateAutoCalibSample(frame("front", { hasFace: false }), 0)).toBe("no-face");
    expect(evaluateAutoCalibSample(frame("front"), 1000)).toBe("stale");
    expect(evaluateAutoCalibSample(frame("front", { depthCm: 90 }), 0)).toBe("depth");
    expect(evaluateAutoCalibSample(frame("front", { depthCm: 10 }), 0)).toBe("depth");
    expect(evaluateAutoCalibSample(frame("yaw_left_30"), 0)).toBe("not-frontal");
    expect(evaluateAutoCalibSample(frame("pitch_down"), 0)).toBe("not-frontal");
  });

  it("rejects closed eyes", () => {
    const f = frame("front");
    const l = f.landmarks.slice();
    // Collapse both eyelid apertures onto the iris centre line.
    l[159] = { ...l[159], y: l[468].y }; l[145] = { ...l[145], y: l[468].y };
    l[386] = { ...l[386], y: l[473].y }; l[374] = { ...l[374], y: l[473].y };
    expect(evaluateAutoCalibSample({ ...f, landmarks: l }, 0)).toBe("eyes");
  });

  it("accepts a frontal, open-eyed, in-range detection", () => {
    // The synthetic fixture leaves eyelid points at the default; open them.
    const f = frame("front");
    const l = f.landmarks.slice();
    const open = (top: number, bot: number, iris: number) => {
      l[top] = { ...l[top], x: l[iris].x, y: l[iris].y - 0.012 };
      l[bot] = { ...l[bot], x: l[iris].x, y: l[iris].y + 0.012 };
    };
    open(159, 145, 468);
    open(386, 374, 473);
    // …and give the irises a horizontal diameter (outer/inner points).
    l[469] = { ...l[468], x: l[468].x - 0.01 }; l[471] = { ...l[468], x: l[468].x + 0.01 };
    l[476] = { ...l[473], x: l[473].x - 0.01 }; l[474] = { ...l[473], x: l[473].x + 0.01 };
    const v = evaluateAutoCalibSample({ ...f, landmarks: l }, 0);
    expect(typeof v).toBe("object");
    if (typeof v === "object" && v) {
      expect(v.measure.irisDiamPx).toBeGreaterThan(0);
      expect(v.aspect).toBeCloseTo(16 / 9, 3);
    }
  });
});
