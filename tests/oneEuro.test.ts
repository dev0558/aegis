import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../src/input/oneEuro';
import { mulberry32 } from '../src/util/prng';

const variance = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
};

describe('OneEuroFilter', () => {
  it('passes a constant signal through unchanged', () => {
    const f = new OneEuroFilter();
    for (let i = 0; i < 30; i++) expect(f.filter(0.42, i / 30)).toBeCloseTo(0.42, 10);
  });

  it('strongly reduces jitter on a stationary signal', () => {
    const rng = mulberry32(3);
    const f = new OneEuroFilter();
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const v = 0.5 + (rng() - 0.5) * 0.01;
      raw.push(v);
      out.push(f.filter(v, i / 30));
    }
    expect(variance(out.slice(30))).toBeLessThan(variance(raw.slice(30)) * 0.25);
  });

  it('lags fast motion less than a fixed low-pass (beta adapts the cutoff)', () => {
    const adaptive = new OneEuroFilter({ minCutoff: 1.4, beta: 2.5, dCutoff: 1 });
    const fixed = new OneEuroFilter({ minCutoff: 1.4, beta: 0, dCutoff: 1 });
    let a = 0;
    let b = 0;
    const speed = 1.5; // frame widths per second
    for (let i = 0; i <= 15; i++) {
      const t = i / 30;
      a = adaptive.filter(speed * t, t);
      b = fixed.filter(speed * t, t);
    }
    const target = speed * 0.5;
    expect(target - a).toBeLessThan((target - b) * 0.6);
  });

  it('restarts cleanly after reset', () => {
    const f = new OneEuroFilter();
    f.filter(0, 0);
    f.filter(1, 0.1);
    f.reset();
    expect(f.filter(5, 0.2)).toBe(5);
  });
});
