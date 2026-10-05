import { IRIS_DIAMETER_MM, LM } from "@/lib/mediapipe/constants";
import type { LandmarkPoint } from "@/store/tryOnStore";

/**
 * Stable face metrics from a front-facing calibration burst.
 *
 * faceWidthMm = outer canthus → outer canthus (LM 33 ↔ 263), NOT skull
 * bitemporal / temple-to-temple width. Adult inter-outer-canthal distance is
 * typically ~90–100 mm; ~80 mm is small but plausible (or slight iris-mm bias).
 * Bitemporal width would be ~130–150 mm — if you ever see that here, the wrong
 * landmarks are being used.
 */
export type FaceProfile = {
  ipdMm: number;
  /** Outer canthi (33–263) width in mm via iris 11.7 mm ruler. */
  faceWidthMm: number;
  /**
   * Averaged outer-canthi span in scene units at calibration distance.
   * Used as the frozen geometric base so live scale does NOT re-multiply
   * noisy per-frame span (that was amplifying σ by ~frameWidth/faceWidth).
   */
  refEyeSpanScene: number;
  capturedAt: number;
};

export type FaceMeasurePx = {
  irisDiamPx: number;
  /** Eyelid aperture / iris diameter (both eyes, min). ≥ ~0.8 = eyes open. */
  eyeOpenness: number;
  ipdPx: number;
  faceWidthPx: number;
  midEyeX: number;
  midEyeY: number;
  /** Scene-unit outer-canthi span for this frame (same space as fitPose). */
  eyeSpanScene: number;
};

export const FACE_PROFILE_STORAGE_KEY = "eyenetra:faceProfile";

/** Normalized mid-eye motion threshold between kept calibration frames. */
export const CALIB_MOTION_THRESHOLD = 0.008;
export const CALIB_MIN_KEPT = 10;
export const CALIB_TARGET_FRAMES = 28;
export const CALIB_DURATION_MS = 1500;

function dist2(a: LandmarkPoint, b: LandmarkPoint, width: number, height: number): number {
  const dx = (a.x - b.x) * width;
  const dy = (a.y - b.y) * height;
  return Math.hypot(dx, dy);
}

function writeLog(action: string, detail: unknown) {
  const stack = new Error().stack?.split("\n").slice(2, 6).join(" ← ") ?? "";
  console.info(`[EyeNetra:calib:write] ${action}`, detail, `\n  via ${stack}`);
}

/** Per-frame measures in actual image pixels; x/y landmarks use different axes. */
export function measureFacePx(
  landmarks: LandmarkPoint[],
  eyeSpanScene: number,
  videoWidth: number,
  videoHeight: number,
): FaceMeasurePx | null {
  if (!(videoWidth > 0) || !(videoHeight > 0)) return null;
  const lOuter = landmarks[LM.LEFT_IRIS_OUTER];
  const lInner = landmarks[LM.LEFT_IRIS_INNER];
  const rOuter = landmarks[LM.RIGHT_IRIS_OUTER];
  const rInner = landmarks[LM.RIGHT_IRIS_INNER];
  const lIris = landmarks[LM.LEFT_IRIS];
  const rIris = landmarks[LM.RIGHT_IRIS];
  // faceWidthPx: LEFT_EYE_OUTER (33) ↔ RIGHT_EYE_OUTER (263) — outer canthi only.
  const leftCanthus = landmarks[LM.LEFT_EYE_OUTER];
  const rightCanthus = landmarks[LM.RIGHT_EYE_OUTER];
  const mid =
    landmarks[LM.MID_EYES] ??
    landmarks[LM.NOSE_BRIDGE] ??
    (lIris && rIris
      ? {
          x: (lIris.x + rIris.x) / 2,
          y: (lIris.y + rIris.y) / 2,
          z: 0,
        }
      : null);

  if (
    !lOuter ||
    !lInner ||
    !rOuter ||
    !rInner ||
    !lIris ||
    !rIris ||
    !leftCanthus ||
    !rightCanthus ||
    !mid ||
    !(eyeSpanScene > 0)
  ) {
    return null;
  }

  const leftIrisDiam = dist2(lOuter, lInner, videoWidth, videoHeight);
  const rightIrisDiam = dist2(rOuter, rInner, videoWidth, videoHeight);
  const irisDiamPx = (leftIrisDiam + rightIrisDiam) / 2;
  if (irisDiamPx < 1e-6) return null;

  // Eyelid aperture relative to the iris: a half-closed eye hides the iris
  // top/bottom and the iris-outer/inner points drift, which under-measures
  // the ruler and inflates every mm figure derived from it.
  const lTop = landmarks[LM.LEFT_EYE_TOP], lBot = landmarks[LM.LEFT_EYE_BOTTOM];
  const rTop = landmarks[LM.RIGHT_EYE_TOP], rBot = landmarks[LM.RIGHT_EYE_BOTTOM];
  const eyeOpenness =
    lTop && lBot && rTop && rBot
      ? Math.min(
          dist2(lTop, lBot, videoWidth, videoHeight) / Math.max(1e-6, leftIrisDiam),
          dist2(rTop, rBot, videoWidth, videoHeight) / Math.max(1e-6, rightIrisDiam),
        )
      : 1;

  return {
    irisDiamPx,
    eyeOpenness,
    ipdPx: dist2(lIris, rIris, videoWidth, videoHeight),
    faceWidthPx: dist2(leftCanthus, rightCanthus, videoWidth, videoHeight),
    midEyeX: mid.x,
    midEyeY: mid.y,
    eyeSpanScene,
  };
}

export function pxToMm(measure: FaceMeasurePx): {
  ipdMm: number;
  faceWidthMm: number;
} {
  const mmPerPx = IRIS_DIAMETER_MM / measure.irisDiamPx;
  return {
    ipdMm: measure.ipdPx * mmPerPx,
    faceWidthMm: measure.faceWidthPx * mmPerPx,
  };
}

/**
 * Keep frames where mid-eye motion vs previous kept is below threshold.
 * Returns averaged profile or null if too few kept samples.
 */
export function stableMeasureIndices(
  measures: FaceMeasurePx[],
  motionThreshold = CALIB_MOTION_THRESHOLD,
): number[] {
  const kept: number[] = [];
  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    if (kept.length === 0) {
      kept.push(i);
      continue;
    }
    const prev = measures[kept[kept.length - 1]];
    const motion = Math.hypot(m.midEyeX - prev.midEyeX, m.midEyeY - prev.midEyeY);
    if (motion > motionThreshold) continue;
    kept.push(i);
  }
  return kept;
}

export function buildProfileFromMeasures(
  measures: FaceMeasurePx[],
  motionThreshold = CALIB_MOTION_THRESHOLD,
  minKept = CALIB_MIN_KEPT,
): FaceProfile | null {
  const kept = stableMeasureIndices(measures, motionThreshold);

  if (kept.length < minKept) return null;

  let ipdSum = 0;
  let faceSum = 0;
  let spanSum = 0;
  for (const i of kept) {
    const m = measures[i];
    const mm = pxToMm(m);
    ipdSum += mm.ipdMm;
    faceSum += mm.faceWidthMm;
    spanSum += m.eyeSpanScene;
  }
  const n = kept.length;
  return {
    ipdMm: ipdSum / n,
    faceWidthMm: faceSum / n,
    refEyeSpanScene: spanSum / n,
    capturedAt: Date.now(),
  };
}

/** Minimum eyelid aperture (fraction of iris diameter) for a usable sample. */
export const CALIB_MIN_EYE_OPENNESS = 0.6;

function median(values: number[]): number {
  const a = values.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export type RobustProfile = {
  profile: FaceProfile;
  /** Robust σ (1.4826·MAD) of per-sample faceWidthMm. */
  sigmaMm: number;
  n: number;
};

/**
 * Median-based profile with a robust spread estimate. Unlike the mean, a few
 * blink/turn frames cannot drag the ruler; the caller decides whether σ is
 * good enough to save (customers never hold still on purpose, so the
 * background calibrator keeps sampling until σ < 1 mm).
 */
export function robustProfileFromMeasures(
  measures: FaceMeasurePx[],
  minKept = CALIB_MIN_KEPT,
): RobustProfile | null {
  const good = measures.filter((m) => m.eyeOpenness >= CALIB_MIN_EYE_OPENNESS);
  if (good.length < minKept) return null;
  const widths = good.map((m) => pxToMm(m).faceWidthMm);
  const ipds = good.map((m) => pxToMm(m).ipdMm);
  const spans = good.map((m) => m.eyeSpanScene);
  const w = median(widths);
  const mad = median(widths.map((x) => Math.abs(x - w)));
  return {
    profile: {
      ipdMm: median(ipds),
      faceWidthMm: w,
      refEyeSpanScene: median(spans),
      capturedAt: Date.now(),
    },
    sigmaMm: 1.4826 * mad,
    n: good.length,
  };
}

export function isValidFaceProfile(
  p: Partial<FaceProfile> | null | undefined,
): p is FaceProfile {
  return (
    !!p &&
    typeof p.ipdMm === "number" &&
    typeof p.faceWidthMm === "number" &&
    typeof p.refEyeSpanScene === "number" &&
    typeof p.capturedAt === "number" &&
    p.ipdMm > 0 &&
    p.faceWidthMm > 0 &&
    p.refEyeSpanScene > 0
  );
}

export function loadFaceProfile(): FaceProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FACE_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FaceProfile>;
    // Legacy profiles without refEyeSpanScene cannot drive frozen scale — drop them.
    if (!isValidFaceProfile(parsed)) {
      console.info(
        "[EyeNetra:calib:write] load rejected (missing refEyeSpanScene or invalid) — recalibrate",
        parsed,
      );
      return null;
    }
    return {
      ipdMm: parsed.ipdMm,
      faceWidthMm: parsed.faceWidthMm,
      refEyeSpanScene: parsed.refEyeSpanScene,
      capturedAt: parsed.capturedAt,
    };
  } catch {
    return null;
  }
}

export function saveFaceProfile(profile: FaceProfile): void {
  if (typeof window === "undefined") return;
  writeLog("localStorage.setItem", {
    ipdMm: profile.ipdMm,
    faceWidthMm: profile.faceWidthMm,
    refEyeSpanScene: profile.refEyeSpanScene,
  });
  localStorage.setItem(FACE_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function clearFaceProfile(): void {
  if (typeof window === "undefined") return;
  writeLog("localStorage.removeItem", null);
  localStorage.removeItem(FACE_PROFILE_STORAGE_KEY);
}
