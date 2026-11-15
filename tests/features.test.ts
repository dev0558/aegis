import { describe, expect, it } from 'vitest';
import { extractFeatures, viewToScreen } from '../src/input/features';
import { FIST, OPEN, POINT, syntheticHand } from './fixtures/syntheticHand';

const ASPECT = 16 / 9;
const extended = (ext: readonly number[]) => ext.map((e) => e >= 1);
const curled = (ext: readonly number[]) => ext.map((e) => e < 0.6);

describe('extractFeatures', () => {
  it('detects an open hand', () => {
    const f = extractFeatures(syntheticHand({ fingers: OPEN }), ASPECT);
    expect(extended(f.ext)).toEqual([true, true, true, true, true]);
    expect(f.pinch).toBeGreaterThan(0.42);
  });

  it('detects a fist', () => {
    const f = extractFeatures(syntheticHand({ fingers: FIST }), ASPECT);
    expect(curled(f.ext)).toEqual([true, true, true, true, true]);
  });

  it('detects a pointing index finger', () => {
    const f = extractFeatures(syntheticHand({ fingers: POINT }), ASPECT);
    expect(f.ext[1]).toBeGreaterThanOrEqual(1);
    expect(curled([f.ext[0], f.ext[2], f.ext[3], f.ext[4]])).toEqual([true, true, true, true]);
  });

  it('distinguishes thumb-first counts 1–5', () => {
    for (let n = 1; n <= 5; n++) {
      const fingers = [0, 1, 2, 3, 4].map((i) => i < n) as typeof OPEN;
      const f = extractFeatures(syntheticHand({ fingers }), ASPECT);
      expect(extended(f.ext)).toEqual(fingers);
    }
  });

  it('detects a pinch', () => {
    const f = extractFeatures(syntheticHand({ fingers: OPEN, pinch: true }), ASPECT);
    expect(f.pinch).toBeLessThan(0.26);
  });

  it('is invariant to position, scale and in-plane rotation', () => {
    for (const rotation of [-0.6, 0, 0.5]) {
      for (const scale of [0.08, 0.18, 0.3]) {
        const f = extractFeatures(
          syntheticHand({ fingers: POINT, rotation, scale, cx: 0.3, cy: 0.6 }),
          ASPECT,
        );
        expect(f.ext[1]).toBeGreaterThanOrEqual(1);
        expect(f.ext[2]).toBeLessThan(0.6);
        expect(f.handScale).toBeCloseTo(scale, 3);
      }
    }
  });

  it('reports palm position in mirrored view space', () => {
    const f = extractFeatures(syntheticHand({ fingers: OPEN, cx: 0.25, cy: 0.4 }), ASPECT);
    expect(f.palm.x).toBeCloseTo(0.25, 5);
    expect(f.palm.y).toBeCloseTo(0.4, 5);
  });
});

describe('viewToScreen', () => {
  it('matches a mirrored object-fit: cover video', () => {
    // 1280×720 video on a 1000×1000 screen: scaled to 1777.8×1000, cropped horizontally.
    const p = viewToScreen({ x: 0.5, y: 0.5 }, 1280, 720, 1000, 1000);
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(500);
    const left = viewToScreen({ x: 0, y: 0 }, 1280, 720, 1000, 1000);
    expect(left.x).toBeCloseTo((1000 - 1777.78) / 2, 1);
    expect(left.y).toBeCloseTo(0);
  });
});
