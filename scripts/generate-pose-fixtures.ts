/**
 * Generates MediaPipe-shaped pose fixtures with known Euler angles.
 * Matrices are authored PRE-mirror; computePose applies video mirror.
 * Run: npx tsx scripts/generate-pose-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { LM } from "../src/lib/mediapipe/constants";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "test-fixtures/pose");

type Expect = {
  yawSign: -1 | 0 | 1;
  yawAbsDegMin?: number;
  yawAbsDegMax?: number;
  pitchSign?: -1 | 0 | 1;
  pitchAbsDegMin?: number;
  scaleMin: number;
  scaleMax: number;
};

function blankLandmarks(n = 478): { x: number; y: number; z: number }[] {
  return Array.from({ length: n }, () => ({ x: 0.5, y: 0.5, z: 0 }));
}

/** Face landmarks; `proximity` > 1 = closer (larger eye span in frame). */
function faceLandmarks(proximity = 1) {
  const lms = blankLandmarks();
  const midX = 0.5;
  const midY = 0.48;
  const halfIpd = 0.035 * proximity;
  const halfFace = 0.055 * proximity;
  const irisR = 0.012 * proximity;

  const set = (i: number, x: number, y: number, z = 0) => {
    lms[i] = { x, y, z };
  };

  set(LM.LEFT_IRIS, midX - halfIpd, midY);
  set(LM.RIGHT_IRIS, midX + halfIpd, midY);
  set(LM.LEFT_IRIS_OUTER, midX - halfIpd - irisR, midY);
  set(LM.LEFT_IRIS_INNER, midX - halfIpd + irisR, midY);
  set(LM.RIGHT_IRIS_INNER, midX + halfIpd - irisR, midY);
  set(LM.RIGHT_IRIS_OUTER, midX + halfIpd + irisR, midY);
  set(LM.LEFT_EYE_OUTER, midX - halfFace, midY);
  set(LM.RIGHT_EYE_OUTER, midX + halfFace, midY);
  set(LM.MID_EYES, midX, midY);
  set(LM.NOSE_BRIDGE, midX, midY + 0.02);
  return lms;
}

/**
 * Build MP-compatible column-major matrix from Euler YXZ (pre-mirror).
 * After computePose's mirror conjugation, yaw and roll signs flip.
 */
function matrixFromEulerDeg(pitchDeg: number, yawDeg: number, rollDeg = 0) {
  const q = new Quaternion().setFromEuler(
    new Euler(
      (pitchDeg * Math.PI) / 180,
      (yawDeg * Math.PI) / 180,
      (rollDeg * Math.PI) / 180,
      "YXZ",
    ),
  );
  const m = new Matrix4().compose(new Vector3(0, 0, 0), q, new Vector3(1, 1, 1));
  return Array.from(m.elements);
}

const fixtures: {
  id: string;
  pitch: number;
  yaw: number;
  proximity: number;
  expect: Expect;
}[] = [
  // Pre-mirror yaw +30 → after mirror yaw ≈ -30 (sign -1) = subject turned their left
  // We label files by subject motion; expect matches POST-computePose yaw.
  {
    id: "front",
    pitch: 0,
    yaw: 0,
    proximity: 1,
    expect: {
      yawSign: 0,
      yawAbsDegMax: 8,
      scaleMin: 0.15,
      scaleMax: 2.8,
    },
  },
  {
    id: "yaw_left_30",
    pitch: 0,
    yaw: -30, // subject left; expect matches post-computePose yaw sign
    proximity: 1,
    expect: {
      yawSign: -1,
      yawAbsDegMin: 18,
      yawAbsDegMax: 45,
      scaleMin: 0.15,
      scaleMax: 2.8,
    },
  },
  {
    id: "yaw_right_30",
    pitch: 0,
    yaw: 30,
    proximity: 1,
    expect: {
      yawSign: 1,
      yawAbsDegMin: 18,
      yawAbsDegMax: 45,
      scaleMin: 0.15,
      scaleMax: 2.8,
    },
  },
  {
    id: "pitch_down",
    pitch: 20,
    yaw: 0,
    proximity: 1,
    expect: {
      yawSign: 0,
      yawAbsDegMax: 12,
      pitchSign: -1,
      pitchAbsDegMin: 10,
      scaleMin: 0.15,
      scaleMax: 2.8,
    },
  },
  {
    id: "close",
    pitch: 0,
    yaw: 0,
    proximity: 1.55,
    expect: {
      yawSign: 0,
      yawAbsDegMax: 8,
      scaleMin: 0.15,
      scaleMax: 2.8,
    },
  },
];

mkdirSync(outDir, { recursive: true });

for (const f of fixtures) {
  const payload = {
    id: f.id,
    videoWidth: 1280,
    videoHeight: 720,
    landmarks: faceLandmarks(f.proximity),
    transformMatrix: matrixFromEulerDeg(f.pitch, f.yaw),
    expect: f.expect,
    _meta: {
      note: "Synthetic MediaPipe-shaped fixture; replace via Dev Snapshot for live captures.",
      preMirrorEulerDeg: { pitch: f.pitch, yaw: f.yaw },
    },
  };
  writeFileSync(join(outDir, `${f.id}.json`), JSON.stringify(payload, null, 2));
  console.log("wrote", f.id);
}
