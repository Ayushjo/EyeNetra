/**
 * Cheap ambient light estimation from the webcam frame: mean RGB + bright
 * percentile → light rig intensities and color temperature. Sampled at a low
 * cadence (500 ms) on a 16×12 canvas — negligible cost.
 */
export type LightEstimate = {
  /** Ambient light intensity. */
  ambient: number;
  /** Key (directional) light intensity. */
  key: number;
  /** Normalized RGB tint for the lights. */
  color: [number, number, number];
};

export const DEFAULT_LIGHT_ESTIMATE: LightEstimate = {
  ambient: 0.35,
  key: 0.9,
  color: [1, 1, 1],
};

/**
 * Map frame statistics to the light rig. Pure.
 * @param meanRgb mean channel values 0..255
 * @param p90Luma 90th-percentile luminance 0..255 (highlight level)
 */
export function mapLightEstimate(
  meanRgb: [number, number, number],
  p90Luma: number,
): LightEstimate {
  const meanLuma =
    0.2126 * meanRgb[0] + 0.7152 * meanRgb[1] + 0.0722 * meanRgb[2];
  // Dim room ~30, normal ~110, bright ~180.
  const level = Math.min(1, Math.max(0, (meanLuma - 20) / 160));
  const highlight = Math.min(1, Math.max(0, (p90Luma - 40) / 200));
  const ambient = 0.2 + 0.4 * level;
  const key = 0.5 + 0.7 * highlight;
  // Tint from the mean chromaticity, pulled halfway toward white so the
  // glasses never go fully color-cast.
  const maxC = Math.max(meanRgb[0], meanRgb[1], meanRgb[2], 1);
  const color: [number, number, number] = [
    0.5 + 0.5 * (meanRgb[0] / maxC),
    0.5 + 0.5 * (meanRgb[1] / maxC),
    0.5 + 0.5 * (meanRgb[2] / maxC),
  ];
  return { ambient, key, color };
}

/** Compute frame statistics from RGBA pixel data (any small resolution). */
export function frameStats(
  data: Uint8ClampedArray,
): { meanRgb: [number, number, number]; p90Luma: number } | null {
  const n = data.length / 4;
  if (n < 4) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  const lumas: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const R = data[i * 4];
    const G = data[i * 4 + 1];
    const B = data[i * 4 + 2];
    r += R;
    g += G;
    b += B;
    lumas[i] = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }
  lumas.sort((a, b2) => a - b2);
  return {
    meanRgb: [r / n, g / n, b / n],
    p90Luma: lumas[Math.min(n - 1, Math.floor(n * 0.9))],
  };
}

/** Slow EMA so lighting shifts read as gradual (τ ≈ 2 s at 0.5 s cadence). */
export function emaLight(
  prev: LightEstimate,
  next: LightEstimate,
  alpha = 0.22,
): LightEstimate {
  const mix = (a: number, b: number) => a + (b - a) * alpha;
  return {
    ambient: mix(prev.ambient, next.ambient),
    key: mix(prev.key, next.key),
    color: [
      mix(prev.color[0], next.color[0]),
      mix(prev.color[1], next.color[1]),
      mix(prev.color[2], next.color[2]),
    ],
  };
}
