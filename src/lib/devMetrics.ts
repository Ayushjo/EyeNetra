/**
 * Dev-only timing collector for the readout under the wordmark
 * (components/DevFpsReadout.tsx). Hot paths call devSample()/devCount(); the
 * readout takes a snapshot once a second, which also starts a new window.
 * In production builds every call is a no-op.
 */
const ENABLED = process.env.NODE_ENV === "development";

type Acc = { sum: number; n: number; max: number };
const series = new Map<string, Acc>();
const counts = new Map<string, number>();
let windowStart = typeof performance !== "undefined" ? performance.now() : 0;

/** Record one timing sample (ms) under `name`. */
export function devSample(name: string, value: number): void {
  if (!ENABLED || !Number.isFinite(value)) return;
  let a = series.get(name);
  if (!a) series.set(name, (a = { sum: 0, n: 0, max: -Infinity }));
  a.sum += value;
  a.n += 1;
  if (value > a.max) a.max = value;
}

/** Count one event (per-second rate in the snapshot). */
export function devCount(name: string): void {
  if (!ENABLED) return;
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

export type DevStat = { avg: number; max: number; n: number };
export type DevSnapshot = {
  /** Window length (s). */
  secs: number;
  stats: Record<string, DevStat>;
  /** Events per second. */
  rates: Record<string, number>;
};

/** Averages / maxima / rates since the last snapshot; starts a new window. */
export function devSnapshot(): DevSnapshot {
  const now = performance.now();
  const secs = Math.max(0.001, (now - windowStart) / 1000);
  const stats: Record<string, DevStat> = {};
  for (const [k, a] of series) if (a.n) stats[k] = { avg: a.sum / a.n, max: a.max, n: a.n };
  const rates: Record<string, number> = {};
  for (const [k, c] of counts) rates[k] = c / secs;
  series.clear();
  counts.clear();
  windowStart = now;
  return { secs, stats, rates };
}
