/**
 * One-Euro filter — adaptive low-pass that smooths when the signal is still and
 * stays responsive when it moves fast. Far better than a fixed lerp for AR pose:
 * a fixed alpha either jitters (high alpha) or lags (low alpha); one-euro gives
 * both — near-zero jitter at rest, near-zero lag during motion.
 *
 * Reference: Casiez, Roussel, Vogel (2012), "1€ Filter".
 *
 * Perf: pure scalar math, allocation-free per update — safe to run per frame.
 */

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroScalar {
  private hatX: number | null = null;
  private hatDx = 0;
  private lastT = 0;

  constructor(
    private minCutoff = 1.2,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  reset(): void {
    this.hatX = null;
    this.hatDx = 0;
    this.lastT = 0;
  }

  setParams(minCutoff: number, beta: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  /** @param t seconds (monotonic). @param x raw sample. */
  filter(t: number, x: number): number {
    if (this.hatX === null) {
      this.hatX = x;
      this.lastT = t;
      return x;
    }
    let dt = t - this.lastT;
    if (!(dt > 0)) dt = 1 / 60;
    this.lastT = t;

    const dx = (x - this.hatX) / dt;
    const aD = alpha(this.dCutoff, dt);
    this.hatDx = aD * dx + (1 - aD) * this.hatDx;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.hatDx);
    const a = alpha(cutoff, dt);
    this.hatX = a * x + (1 - a) * this.hatX;
    return this.hatX;
  }
}

/** Independent one-euro filters over N channels (position xyz, scale, …). */
export class OneEuroVec {
  private filters: OneEuroScalar[];
  constructor(
    private n: number,
    minCutoff = 1.2,
    beta = 0.02,
    dCutoff = 1.0,
  ) {
    this.filters = Array.from(
      { length: n },
      () => new OneEuroScalar(minCutoff, beta, dCutoff),
    );
  }
  reset(): void {
    for (const f of this.filters) f.reset();
  }
  setParams(minCutoff: number, beta: number): void {
    for (const f of this.filters) f.setParams(minCutoff, beta);
  }
  filter(t: number, values: number[], out: number[]): number[] {
    for (let i = 0; i < this.n; i++) out[i] = this.filters[i].filter(t, values[i]);
    return out;
  }
}
