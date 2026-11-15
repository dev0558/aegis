/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012): an adaptive low-pass
 * filter. At low speeds a low cutoff removes jitter; as speed rises the
 * cutoff increases so fast motion is not lagged.
 *
 * Units: time in seconds, cutoffs in Hz. `beta` scales with the signal's
 * units; for normalized (0–1) image coordinates a beta of a few units works.
 */
export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.4, beta: 2.5, dCutoff: 1.0 };

const alpha = (cutoff: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(private readonly p: OneEuroParams = DEFAULT_ONE_EURO) {}

  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const dt = t - this.t;
    if (dt <= 0) return this.x;
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.p.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

/** Filters a flat array of numbers (e.g. 21 landmarks × xyz) element-wise. */
export class VectorOneEuro {
  private readonly filters: OneEuroFilter[];

  constructor(size: number, params: OneEuroParams = DEFAULT_ONE_EURO) {
    this.filters = Array.from({ length: size }, () => new OneEuroFilter(params));
  }

  filter(values: ArrayLike<number>, t: number, out: Float32Array): Float32Array {
    for (let i = 0; i < this.filters.length; i++) {
      out[i] = this.filters[i]!.filter(values[i]!, t);
    }
    return out;
  }

  reset(): void {
    for (const f of this.filters) f.reset();
  }
}
