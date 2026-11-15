import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HandFeatures } from '../src/input/features';
import {
  GESTURE_CONFIG,
  initialGestureState,
  stepGestures,
  type GestureEvent,
} from '../src/input/gestures';
import { HandPipeline } from '../src/input/pipeline';
import type { RecordedFixture } from '../src/input/recorder';
import { FIST, OPEN, syntheticHand, type HandPose } from './fixtures/syntheticHand';

const FPS = 30;
const VW = 1280;
const VH = 720;

interface Timed {
  t: number;
  e: GestureEvent;
}

/** Run a scripted sequence of poses through the full pipeline. */
function simulate(seconds: number, poses: (t: number) => (HandPose | null)[]) {
  const p = new HandPipeline();
  const events: Timed[] = [];
  const modes: { t: number; mode: string; label: string }[] = [];
  for (let i = 0; i <= seconds * FPS; i++) {
    const t = i / FPS;
    const hands = poses(t)
      .filter((h): h is HandPose => h !== null)
      .map((h) => ({ landmarks: syntheticHand({ aspect: VW / VH, ...h }) }));
    const out = p.process({ t: 1000 + t * 1000, hands, videoWidth: VW, videoHeight: VH });
    for (const e of out.events) events.push({ t, e });
    modes.push({ t, mode: out.state.mode, label: out.indicator.label });
  }
  return { events, modes };
}

const types = (ev: Timed[]) => ev.map((x) => x.e.type);
const modeAt = (m: { t: number; mode: string }[], t: number) =>
  m.reduce((acc, x) => (x.t <= t + 1e-9 ? x : acc)).mode;

describe('rotate (one open hand)', () => {
  it('engages only after the open hand is held briefly', () => {
    const { modes } = simulate(0.5, () => [{ fingers: OPEN }]);
    expect(modeAt(modes, 0.05)).toBe('idle');
    expect(modeAt(modes, 0.3)).toBe('rotate');
  });

  it('maps hand movement to rotation velocity in the same direction', () => {
    // Move right and down at 0.4 frame-widths/s.
    const { events } = simulate(1.2, (t) => [
      { fingers: OPEN, cx: 0.3 + 0.4 * t, cy: 0.4 + 0.2 * t },
    ]);
    const rot = events.filter((x) => x.e.type === 'rotate' && x.t > 0.8).map((x) => x.e);
    expect(rot.length).toBeGreaterThan(5);
    for (const e of rot) {
      if (e.type !== 'rotate') continue;
      expect(e.vx).toBeGreaterThan(0.25);
      expect(e.vy).toBeGreaterThan(0.08);
    }
  });

  it('holds still (zero velocity) when the hand is still', () => {
    const { events } = simulate(1, () => [{ fingers: OPEN, cx: 0.5 }]);
    const late = events.filter((x) => x.t > 0.5 && x.e.type === 'rotate');
    expect(late.every((x) => x.e.type === 'rotate' && x.e.vx === 0 && x.e.vy === 0)).toBe(true);
  });

  it('ignores a one-frame dropout but releases (for inertia) when the hand leaves', () => {
    const { events } = simulate(1.5, (t) => {
      if (t > 0.5 && t < 0.54) return []; // single dropped frame
      if (t > 1.0) return [];
      return [{ fingers: OPEN, cx: 0.3 + 0.5 * t }];
    });
    const ends = events.filter((x) => x.e.type === 'rotateEnd');
    expect(ends).toHaveLength(1);
    expect(ends[0]!.t).toBeGreaterThan(1.0 + GESTURE_CONFIG.handLostGrace - 0.05);
  });

  it('stops rotating when the hand closes into a fist', () => {
    const { events, modes } = simulate(1.2, (t) => [{ fingers: t < 0.6 ? OPEN : FIST }]);
    expect(types(events)).toContain('rotateEnd');
    expect(modeAt(modes, 1.1)).toBe('idle');
  });
});

describe('zoom (two hands)', () => {
  const twoHands = (d: (t: number) => number) => (t: number) => [
    { fingers: OPEN, cx: 0.5 - d(t) / 2 },
    { fingers: OPEN, cx: 0.5 + d(t) / 2 },
  ];

  it('debounces engagement', () => {
    const { events } = simulate(
      0.5,
      twoHands(() => 0.3),
    );
    const start = events.find((x) => x.e.type === 'zoomStart');
    expect(start).toBeDefined();
    expect(start!.t).toBeGreaterThanOrEqual(GESTURE_CONFIG.zoomEngage - 1e-9);
  });

  it('spreading zooms in, closing zooms out', () => {
    const spread = simulate(
      1.2,
      twoHands((t) => 0.25 + 0.3 * t),
    );
    const last = spread.events.filter((x) => x.e.type === 'zoom').at(-1)!.e;
    expect(last.type === 'zoom' && last.ratio).toBeGreaterThan(1.5);

    const close = simulate(
      1.2,
      twoHands((t) => 0.6 - 0.3 * t),
    );
    const lastC = close.events.filter((x) => x.e.type === 'zoom').at(-1)!.e;
    expect(lastC.type === 'zoom' && lastC.ratio).toBeLessThan(0.65);
  });

  it('applies a deadband so a steady pair does not drift', () => {
    const { events } = simulate(
      1,
      twoHands((t) => 0.3 + 0.005 * Math.sin(t * 20)),
    );
    const zooms = events.filter((x) => x.e.type === 'zoom');
    expect(zooms.every((x) => x.e.type === 'zoom' && x.e.ratio === 1)).toBe(true);
  });

  it('does not let the remaining hand rotate immediately after zooming', () => {
    const { modes } = simulate(1.4, (t) =>
      t < 0.6 ? twoHands(() => 0.3)(t) : [{ fingers: OPEN, cx: 0.35 }],
    );
    const after = 0.6 + GESTURE_CONFIG.handLostGrace;
    expect(modeAt(modes, after + 0.1)).not.toBe('rotate');
    expect(modeAt(modes, 1.35)).toBe('rotate');
  });
});

describe('reducer properties', () => {
  const feat = (ext: number[], x = 0.5): HandFeatures => ({
    palm: { x, y: 0.5 },
    indexTip: { x, y: 0.3 },
    pinchPoint: { x, y: 0.35 },
    handScale: 0.2,
    ext: ext as unknown as HandFeatures['ext'],
    pinch: 0.8,
  });

  it('applies hysteresis to finger extension', () => {
    let s = initialGestureState();
    const step = (ext: number[], t: number) => {
      s = stepGestures(s, { t, aspect: 1.78, hands: [feat(ext), null] }).state;
      return s.hands[0]!.fingers;
    };
    // 0.9 is below the "on" threshold: not extended yet.
    expect(step([0, 0.9, 0, 0, 0], 1)[1]).toBe(false);
    expect(step([0, 1.1, 0, 0, 0], 1.03)[1]).toBe(true);
    // Dipping to 0.7 (above "off") keeps it extended.
    expect(step([0, 0.7, 0, 0, 0], 1.06)[1]).toBe(true);
    expect(step([0, 0.5, 0, 0, 0], 1.09)[1]).toBe(false);
  });

  it('is deterministic: replaying the same frames yields identical events', () => {
    const run = () => simulate(1, (t) => [{ fingers: OPEN, cx: 0.3 + 0.3 * t }]).events;
    expect(run()).toEqual(run());
  });
});

// Real recordings captured with the dev recorder (Shift+R) become regression tests.
describe('recorded fixtures', () => {
  const dir = join(import.meta.dirname, 'fixtures', 'recorded');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (!files.length) {
    it.skip('no recordings yet (capture with Shift+R in dev)', () => undefined);
    return;
  }
  for (const file of files) {
    it(file, () => {
      const fx = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RecordedFixture;
      const p = new HandPipeline();
      const seen = new Set<string>();
      for (const f of fx.frames) {
        const out = p.process({
          ...f,
          hands: f.hands.map((h) => ({ landmarks: Float32Array.from(h.landmarks) })),
        });
        for (const e of out.events) seen.add(e.type);
      }
      for (const e of fx.meta.expect) expect(seen, `expected ${e}`).toContain(e);
      for (const e of fx.meta.forbid) expect(seen, `forbidden ${e}`).not.toContain(e);
    });
  }
});
