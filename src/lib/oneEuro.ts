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

/**
 * One-euro on SO(3): slerp toward the raw quaternion with an adaptive alpha
 * driven by angular speed (rad/s). Replaces per-component quaternion
 * filtering, which denormalizes and couples channels. Allocation-free.
 */
export class OneEuroQuat {
  // Filtered output quaternion (x, y, z, w).
  private q: [number, number, number, number] | null = null;
  private hatSpeed = 0;
  private lastT = 0;

  constructor(
    private minCutoff = 1.5,
    private beta = 0.5,
    private dCutoff = 1.0,
  ) {}

  reset(): void {
    this.q = null;
    this.hatSpeed = 0;
    this.lastT = 0;
  }

  setParams(minCutoff: number, beta: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  /**
   * @param t seconds (monotonic). @param raw raw quaternion [x,y,z,w].
   * @param out receives the filtered unit quaternion.
   */
  filter(
    t: number,
    raw: readonly [number, number, number, number] | number[],
    out: number[],
  ): number[] {
    let [rx, ry, rz, rw] = raw as [number, number, number, number];
    if (!this.q) {
      const n = 1 / Math.hypot(rx, ry, rz, rw);
      this.q = [rx * n, ry * n, rz * n, rw * n];
      this.lastT = t;
      out[0] = this.q[0]; out[1] = this.q[1]; out[2] = this.q[2]; out[3] = this.q[3];
      return out;
    }
    let dt = t - this.lastT;
    if (!(dt > 0)) dt = 1 / 60;
    this.lastT = t;

    const q = this.q;
    // Hemisphere continuity.
    let dot = q[0] * rx + q[1] * ry + q[2] * rz + q[3] * rw;
    if (dot < 0) {
      rx = -rx; ry = -ry; rz = -rz; rw = -rw;
      dot = -dot;
    }
    // Angular distance output→raw and low-passed angular speed.
    const angle = 2 * Math.acos(Math.min(1, dot));
    const speed = angle / dt;
    const aD = alpha(this.dCutoff, dt);
    this.hatSpeed = aD * speed + (1 - aD) * this.hatSpeed;

    const cutoff = this.minCutoff + this.beta * this.hatSpeed;
    const a = alpha(cutoff, dt);

    // nlerp (normalized lerp) — indistinguishable from slerp at small angles,
    // cheap, and free of trig edge cases.
    let ox = q[0] + (rx - q[0]) * a;
    let oy = q[1] + (ry - q[1]) * a;
    let oz = q[2] + (rz - q[2]) * a;
    let ow = q[3] + (rw - q[3]) * a;
    const n = 1 / Math.hypot(ox, oy, oz, ow);
    ox *= n; oy *= n; oz *= n; ow *= n;
    q[0] = ox; q[1] = oy; q[2] = oz; q[3] = ow;
    out[0] = ox; out[1] = oy; out[2] = oz; out[3] = ow;
    return out;
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
