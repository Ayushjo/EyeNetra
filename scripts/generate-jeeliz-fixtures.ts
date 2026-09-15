/**
 * Jeeliz detectState fixtures (no MediaPipe landmarks).
 * Run: npx tsx scripts/generate-jeeliz-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "test-fixtures/pose/jeeliz");

const fixtures = [
  {
    id: "front",
    detect: { detected: 1, x: 0, y: 0, s: 0.55, rx: 0, ry: 0, rz: 0 },
    expect: { yawSign: 0 as const, yawAbsDegMax: 8, scaleMin: 0.15, scaleMax: 2.8 },
  },
  {
    id: "yaw_left_30",
    // After mirror, ry flips sign — expect matches jeelizDetectToFrame output.
    detect: {
      detected: 1,
      x: 0.05,
      y: 0,
      s: 0.55,
      rx: 0,
      ry: 0.52,
      rz: 0,
    },
    expect: {
      yawSign: -1 as const,
      yawAbsDegMin: 18,
      yawAbsDegMax: 45,
      scaleMin: 0.15,
      scaleMax: 2.8,
    },
  },
  {
    id: "yaw_right_30",
    detect: {
      detected: 1,
      x: -0.05,
      y: 0,
      s: 0.55,
      rx: 0,
      ry: -0.52,
      rz: 0,
    },
    expect: {
      yawSign: 1 as const,
      yawAbsDegMin: 18,
      yawAbsDegMax: 45,
      scaleMin: 0.15,
      scaleMax: 2.8,
    },
  },
  {
    id: "pitch_down",
    detect: {
      detected: 1,
      x: 0,
      y: 0.08,
      s: 0.55,
      rx: 0.35,
      ry: 0,
      rz: 0,
    },
    expect: {
      yawSign: 0 as const,
      yawAbsDegMax: 12,
      pitchSign: 1 as const,
      pitchAbsDegMin: 10,
      scaleMin: 0.15,
      scaleMax: 2.8,
    },
  },
  {
    id: "close",
    detect: { detected: 1, x: 0, y: 0, s: 0.9, rx: 0, ry: 0, rz: 0 },
    expect: { yawSign: 0 as const, yawAbsDegMax: 8, scaleMin: 0.15, scaleMax: 2.8 },
  },
];

mkdirSync(outDir, { recursive: true });
for (const f of fixtures) {
  writeFileSync(
    join(outDir, `${f.id}.json`),
    JSON.stringify(
      {
        id: f.id,
        videoWidth: 1280,
        videoHeight: 720,
        detect: f.detect,
        expect: f.expect,
        _meta: {
          note: "Jeeliz detectState shape — no landmarks/iris. Apache-2.0 FaceFilter.",
        },
      },
      null,
      2,
    ),
  );
  console.log("wrote jeeliz", f.id);
}
