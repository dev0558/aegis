/**
 * Gesture recognition as a pure reducer:
 *
 *   stepGestures(state, frame) → { state, events, indicator }
 *
 * No clocks, no DOM, no mutation of the previous state: replaying a recorded
 * sequence of frames always yields the same events, which is what the unit
 * tests do. Every decision uses hysteresis (separate enter/exit thresholds)
 * and/or debouncing (a condition must hold for a minimum time).
 */
import { viewDistance, type HandFeatures, type Pt } from './features';

export const GESTURE_CONFIG = {
  /** Finger extension score hysteresis. */
  fingerOn: 1.0,
  fingerOff: 0.6,
  /** Open hand: enter at ≥4 extended fingers, exit at ≤2. */
  openEnter: 4,
  openExit: 2,
  /** A hand missing for less than this is treated as still present. */
  handLostGrace: 0.15,
  /** Open hand must be held this long before it starts rotating. */
  rotateEngage: 0.12,
  /** Both hands must be visible this long before zoom engages. */
  zoomEngage: 0.15,
  /** After zoom ends, wait before a single hand may rotate. */
  postZoomCooldown: 0.35,
  /** Palm velocity smoothing rate (1/s). */
  velocitySmoothing: 14,
  /** Speeds below this (frame fractions/s) count as still. */
  velocityDeadzone: 0.05,
  /** Ratio changes within ±this are ignored while zooming. */
  zoomDeadband: 0.03,
};

export type GestureConfig = typeof GESTURE_CONFIG;

export type GestureMode = 'none' | 'idle' | 'rotate' | 'zoom';

export interface HandTrack {
  /** Latest features (frozen while within the lost-hand grace window). */
  f: HandFeatures;
  fingers: readonly [boolean, boolean, boolean, boolean, boolean];
  open: boolean;
  openSince: number;
  firstSeen: number;
  lastSeen: number;
  /** Smoothed palm velocity, frame fractions per second (view space). */
  vel: Pt;
}

export interface GestureState {
  t: number;
  /** Two stable hand slots. */
  hands: readonly [HandTrack | null, HandTrack | null];
  mode: GestureMode;
  twoHandsSince: number | null;
  zoomRef: number;
  zoomRatio: number;
  zoomEndedAt: number;
}

export type GestureEvent =
  | { type: 'rotate'; vx: number; vy: number }
  | { type: 'rotateEnd' }
  | { type: 'zoomStart' }
  | { type: 'zoom'; ratio: number }
  | { type: 'zoomEnd' };

export interface Indicator {
  mode: GestureMode;
  label: string;
  hands: number;
  /** 0..1 while a debounced gesture is arming, otherwise null. */
  progress: number | null;
}

export interface GestureFrame {
  /** Seconds, monotonic. */
  t: number;
  /** Camera width / height. */
  aspect: number;
  /** Per-slot features, null when that slot has no hand this frame. */
  hands: readonly [HandFeatures | null, HandFeatures | null];
}

export function initialGestureState(): GestureState {
  return {
    t: 0,
    hands: [null, null],
    mode: 'none',
    twoHandsSince: null,
    zoomRef: 1,
    zoomRatio: 1,
    zoomEndedAt: -Infinity,
  };
}

function updateTrack(
  prev: HandTrack | null,
  f: HandFeatures | null,
  t: number,
  dt: number,
  cfg: GestureConfig,
): HandTrack | null {
  if (!f) {
    if (!prev || t - prev.lastSeen > cfg.handLostGrace) return null;
    return prev; // within grace: keep the last known state
  }
  const fresh = !prev;
  const fingers = f.ext.map((e, i) => {
    const was = prev?.fingers[i] ?? false;
    return was ? e > cfg.fingerOff : e >= cfg.fingerOn;
  }) as unknown as HandTrack['fingers'];
  const count = fingers.filter(Boolean).length;
  const wasOpen = prev?.open ?? false;
  const open = wasOpen ? count > cfg.openExit : count >= cfg.openEnter;

  let vel: Pt = { x: 0, y: 0 };
  if (prev && dt > 0) {
    const a = 1 - Math.exp(-cfg.velocitySmoothing * dt);
    const rx = (f.palm.x - prev.f.palm.x) / dt;
    const ry = (f.palm.y - prev.f.palm.y) / dt;
    vel = { x: prev.vel.x + (rx - prev.vel.x) * a, y: prev.vel.y + (ry - prev.vel.y) * a };
  }

  return {
    f,
    fingers,
    open,
    openSince: open && !wasOpen ? t : (prev?.openSince ?? t),
    firstSeen: fresh ? t : prev.firstSeen,
    lastSeen: t,
    vel,
  };
}

export function stepGestures(
  prev: GestureState,
  frame: GestureFrame,
  cfg: GestureConfig = GESTURE_CONFIG,
): { state: GestureState; events: GestureEvent[]; indicator: Indicator } {
  const t = frame.t;
  const dt = prev.t > 0 ? Math.min(0.25, t - prev.t) : 0;
  const hands = [
    updateTrack(prev.hands[0], frame.hands[0], t, dt, cfg),
    updateTrack(prev.hands[1], frame.hands[1], t, dt, cfg),
  ] as const;
  const present = hands.filter((h): h is HandTrack => h !== null);
  const n = present.length;
  const events: GestureEvent[] = [];

  let mode = prev.mode;
  let { twoHandsSince, zoomRef, zoomRatio, zoomEndedAt } = prev;
  let progress: number | null = null;

  const endRotate = () => {
    if (mode === 'rotate') events.push({ type: 'rotateEnd' });
  };

  if (n === 2) {
    twoHandsSince ??= t;
    const [a, b] = present as [HandTrack, HandTrack];
    const d = viewDistance(a.f.palm, b.f.palm, frame.aspect);
    if (mode !== 'zoom') {
      endRotate();
      if (t - twoHandsSince >= cfg.zoomEngage) {
        mode = 'zoom';
        zoomRef = Math.max(1e-3, d);
        zoomRatio = 1;
        events.push({ type: 'zoomStart' });
      } else {
        mode = 'idle';
        progress = (t - twoHandsSince) / cfg.zoomEngage;
      }
    } else {
      const r = d / zoomRef;
      if (Math.abs(r - zoomRatio) > 1e-4) {
        zoomRatio = Math.abs(r - 1) < cfg.zoomDeadband ? 1 : r;
        events.push({ type: 'zoom', ratio: zoomRatio });
      }
    }
  } else {
    twoHandsSince = null;
    if (mode === 'zoom') {
      events.push({ type: 'zoomEnd' });
      mode = 'idle';
      zoomEndedAt = t;
    }
    if (n === 1) {
      const h = present[0]!;
      const seenNow = h.lastSeen === t;
      const cooling = t - zoomEndedAt < cfg.postZoomCooldown;
      if (h.open && !cooling) {
        const held = t - h.openSince;
        if (mode === 'rotate' || held >= cfg.rotateEngage) {
          mode = 'rotate';
          if (seenNow) {
            const speed = Math.hypot(h.vel.x, h.vel.y);
            const k = speed < cfg.velocityDeadzone ? 0 : 1 - cfg.velocityDeadzone / speed;
            events.push({ type: 'rotate', vx: h.vel.x * k, vy: h.vel.y * k });
          }
        } else {
          progress = held / cfg.rotateEngage;
          mode = 'idle';
        }
      } else {
        endRotate();
        mode = 'idle';
      }
    } else {
      endRotate();
      mode = 'none';
    }
  }

  const state: GestureState = { t, hands, mode, twoHandsSince, zoomRef, zoomRatio, zoomEndedAt };
  return { state, events, indicator: describe(state, n, progress) };
}

function describe(s: GestureState, n: number, progress: number | null): Indicator {
  let label: string;
  switch (s.mode) {
    case 'zoom':
      label = 'Zoom';
      break;
    case 'rotate':
      label = 'Rotate';
      break;
    case 'none':
      label = 'No hands';
      break;
    case 'idle': {
      if (n === 2) label = 'Two hands';
      else {
        const h = s.hands[0] ?? s.hands[1];
        const c = h ? h.fingers.filter(Boolean).length : 0;
        label = h?.open ? 'Open hand' : c === 0 ? 'Fist' : `${c} finger${c === 1 ? '' : 's'}`;
      }
      break;
    }
  }
  return { mode: s.mode, label, hands: n, progress };
}
