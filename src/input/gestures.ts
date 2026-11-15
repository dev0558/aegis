/**
 * Gesture recognition as a pure reducer:
 *
 *   stepGestures(state, frame) → { state, events, indicator }
 *
 * No clocks, no DOM, no mutation of the previous state: replaying a recorded
 * sequence of frames always yields the same events, which is what the unit
 * tests do. Every decision uses hysteresis (separate enter/exit thresholds)
 * and/or debouncing (a condition must hold for a minimum time).
 *
 * Precedence for a single hand: pinch > fist > point > open hand > count.
 * Two hands always mean zoom and cancel any single-hand gesture.
 *
 * Finger counts use thumb-first counting (1 = thumb, 2 = thumb + index, …,
 * 5 = open hand), so an index-only hand is always "point", never "1".
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
  /** Speeds below this (frame fractions/s) count as no movement for rotation. */
  velocityDeadzone: 0.05,
  /** Ratio changes within ±this are ignored while zooming. */
  zoomDeadband: 0.03,
  /** Pinch ratio hysteresis (thumb–index tip distance / hand size). */
  pinchOn: 0.26,
  pinchOff: 0.42,
  /** A fully curled index (fist) can bring the tips close; don't call that a pinch. */
  pinchMinIndexExt: -0.5,
  /** A pinch released sooner than this is a tap (select / deselect). */
  tapMax: 0.45,
  /** A pinch held on empty space this long starts charging a purge. */
  chargeDelay: 0.25,
  /** Pose must be stable this long before pointing engages. */
  pointEngage: 0.1,
  /** Fist must be held this long to toggle pause. */
  fistHold: 1.0,
  /** A finger count must be held steady this long to apply a filter. */
  countHold: 0.4,
  /** Palm-speed hysteresis for "holding still" (frame fractions/s). */
  stillEnter: 0.12,
  stillExit: 0.22,
  /** A pose held this long becomes the hand's "stable" pose. */
  stablePose: 0.25,
};

export type GestureConfig = typeof GESTURE_CONFIG;

export type GestureMode =
  'none' | 'idle' | 'rotate' | 'zoom' | 'point' | 'pinch' | 'charge' | 'fist' | 'count';

type Fingers5 = readonly [boolean, boolean, boolean, boolean, boolean];

export interface HandTrack {
  /** Latest features (frozen while within the lost-hand grace window). */
  f: HandFeatures;
  fingers: Fingers5;
  open: boolean;
  openSince: number;
  firstSeen: number;
  lastSeen: number;
  /** Smoothed palm velocity, frame fractions per second (view space). */
  vel: Pt;
  still: boolean;
  pinching: boolean;
  /** Current pose key: pinch | fist | point | count1..count5 | other. */
  pose: string;
  poseSince: number;
  /** Last pose held for at least `stablePose` seconds. */
  stablePose: string | null;
  /** Thumb-first count pattern 1..5, or 0. */
  count: number;
  /** When the current count became steady (reset by movement). */
  countSince: number;
  /** The stable pose the hand changed from into this count (null = fresh). */
  countFrom: string | null;
  /** The hand moved since this count pattern began. */
  countMoved: boolean;
  /** This count has already been applied. */
  countDone: boolean;
}

interface PinchState {
  slot: 0 | 1;
  since: number;
  onTarget: boolean;
  charging: boolean;
  pos: Pt;
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
  pinch: PinchState | null;
  pointing: boolean;
  fistSince: number | null;
  fistArmed: boolean;
}

export type GestureEvent =
  | { type: 'rotate'; vx: number; vy: number }
  | { type: 'rotateEnd' }
  | { type: 'zoomStart' }
  | { type: 'zoom'; ratio: number }
  | { type: 'zoomEnd' }
  /** Reticle position (view space): index tip, or pinch point while pinching. */
  | { type: 'point'; pos: Pt }
  | { type: 'pointEnd' }
  /** Quick pinch on a target. */
  | { type: 'select'; pos: Pt }
  /** Quick pinch on empty space. */
  | { type: 'deselect' }
  | { type: 'chargeStart'; pos: Pt }
  | { type: 'charge'; pos: Pt }
  /** commit = released normally (fire the purge); false = cancelled. */
  | { type: 'chargeEnd'; commit: boolean }
  | { type: 'togglePause' }
  | { type: 'count'; n: number };

export interface Indicator {
  mode: GestureMode;
  label: string;
  hands: number;
  /** 0..1 while a debounced gesture is arming, otherwise null. */
  progress: number | null;
  /** Finger count currently shown (1..5) when relevant. */
  count?: number;
}

export interface GestureFrame {
  /** Seconds, monotonic. */
  t: number;
  /** Camera width / height. */
  aspect: number;
  /** Per-slot features, null when that slot has no hand this frame. */
  hands: readonly [HandFeatures | null, HandFeatures | null];
  /**
   * Per-slot: is the pinch point currently over a selectable target (a
   * country)? Supplied by the caller's hit test; only read at pinch onset.
   */
  targets?: readonly [boolean, boolean];
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
    pinch: null,
    pointing: false,
    fistSince: null,
    fistArmed: true,
  };
}

/** Thumb-first count: the first n fingers extended, the rest curled. */
export function countPattern(f: Fingers5): number {
  let n = 0;
  while (n < 5 && f[n]) n++;
  for (let i = n; i < 5; i++) if (f[i]) return 0;
  return n;
}

const isPoint = (f: Fingers5) => !f[0] && f[1] && !f[2] && !f[3] && !f[4];
/**
 * Counts 4/5 double as the open (rotate) hand, so they only apply when the
 * hand was visibly counting just before (a deliberate 1–4 → 4/5 change).
 */
const COUNT_ORIGINS = new Set(['count1', 'count2', 'count3', 'count4']);

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
  const fingers = f.ext.map((e, i) => {
    const was = prev?.fingers[i] ?? false;
    return was ? e > cfg.fingerOff : e >= cfg.fingerOn;
  }) as unknown as Fingers5;
  const extended = fingers.filter(Boolean).length;
  const wasOpen = prev?.open ?? false;
  const open = wasOpen ? extended > cfg.openExit : extended >= cfg.openEnter;

  let vel: Pt = { x: 0, y: 0 };
  if (prev && dt > 0) {
    const a = 1 - Math.exp(-cfg.velocitySmoothing * dt);
    const rx = (f.palm.x - prev.f.palm.x) / dt;
    const ry = (f.palm.y - prev.f.palm.y) / dt;
    vel = { x: prev.vel.x + (rx - prev.vel.x) * a, y: prev.vel.y + (ry - prev.vel.y) * a };
  }
  const speed = Math.hypot(vel.x, vel.y);
  const still = (prev?.still ?? true) ? speed < cfg.stillExit : speed < cfg.stillEnter;

  const wasPinching = prev?.pinching ?? false;
  const pinching =
    f.ext[1] > cfg.pinchMinIndexExt &&
    (wasPinching ? f.pinch < cfg.pinchOff : f.pinch < cfg.pinchOn);

  const count = countPattern(fingers);
  const pose = pinching
    ? 'pinch'
    : extended === 0
      ? 'fist'
      : isPoint(fingers)
        ? 'point'
        : count > 0
          ? `count${count}`
          : 'other';
  const poseSince = prev && prev.pose === pose ? prev.poseSince : t;
  let stablePose = prev?.stablePose ?? null;
  if (t - poseSince >= cfg.stablePose) stablePose = pose;

  let countSince: number;
  let countFrom: string | null;
  let countMoved: boolean;
  let countDone: boolean;
  if (!prev || prev.count !== count || pinching) {
    countSince = t;
    const from = prev?.stablePose ?? null;
    countFrom = from && from !== `count${count}` && COUNT_ORIGINS.has(from) ? from : null;
    countMoved = false;
    countDone = false;
  } else {
    countSince = still ? prev.countSince : t;
    countFrom = prev.countFrom;
    countMoved = prev.countMoved || !still;
    countDone = prev.countDone;
  }

  return {
    f,
    fingers,
    open,
    openSince: open && !wasOpen ? t : (prev?.openSince ?? t),
    firstSeen: prev ? prev.firstSeen : t,
    lastSeen: t,
    vel,
    still,
    pinching,
    pose,
    poseSince,
    stablePose,
    count,
    countSince,
    countFrom,
    countMoved,
    countDone,
  };
}

export function stepGestures(
  prev: GestureState,
  frame: GestureFrame,
  cfg: GestureConfig = GESTURE_CONFIG,
): { state: GestureState; events: GestureEvent[]; indicator: Indicator } {
  const t = frame.t;
  const dt = prev.t > 0 ? Math.min(0.25, t - prev.t) : 0;
  const hands: [HandTrack | null, HandTrack | null] = [
    updateTrack(prev.hands[0], frame.hands[0], t, dt, cfg),
    updateTrack(prev.hands[1], frame.hands[1], t, dt, cfg),
  ];
  const n = (hands[0] ? 1 : 0) + (hands[1] ? 1 : 0);
  const events: GestureEvent[] = [];

  let mode = prev.mode;
  let { twoHandsSince, zoomRef, zoomRatio, zoomEndedAt, pinch, pointing, fistSince, fistArmed } =
    prev;
  let progress: number | null = null;
  let shownCount: number | undefined;

  const endRotate = () => {
    if (mode === 'rotate') events.push({ type: 'rotateEnd' });
  };
  const endPoint = () => {
    if (pointing) events.push({ type: 'pointEnd' });
    pointing = false;
  };
  /** Finish a pinch: released (normal) or cancelled (hand lost / zoom). */
  const endPinch = (released: boolean) => {
    if (!pinch) return;
    if (pinch.charging) events.push({ type: 'chargeEnd', commit: released });
    else if (released && t - pinch.since <= cfg.tapMax) {
      events.push(pinch.onTarget ? { type: 'select', pos: pinch.pos } : { type: 'deselect' });
    }
    pinch = null;
  };

  if (n === 2) {
    endPinch(false);
    endPoint();
    fistSince = null;
    twoHandsSince ??= t;
    const d = viewDistance(hands[0]!.f.palm, hands[1]!.f.palm, frame.aspect);
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

    if (n === 0) {
      endPinch(false);
      endPoint();
      endRotate();
      fistSince = null;
      fistArmed = true;
      mode = 'none';
    } else {
      const slot: 0 | 1 = hands[0] ? 0 : 1;
      const h = hands[slot]!;
      const seen = h.lastSeen === t;

      // Inside the lost-hand grace window nothing changes.
      if (seen) {
        const res = singleHand(h, slot);
        mode = res;
      }
    }
  }

  function singleHand(h: HandTrack, slot: 0 | 1): GestureMode {
    // --- pinch: select (tap) or charge a purge (hold on empty space) -----------
    if (h.pinching) {
      endRotate();
      fistSince = null;
      if (!pinch) {
        pinch = {
          slot,
          since: t,
          onTarget: frame.targets?.[slot] ?? false,
          charging: false,
          pos: h.f.pinchPoint,
        };
      } else {
        pinch = { ...pinch, pos: h.f.pinchPoint };
      }
      pointing = true;
      events.push({ type: 'point', pos: h.f.pinchPoint });
      if (!pinch.onTarget && t - pinch.since >= cfg.chargeDelay) {
        if (!pinch.charging) {
          pinch = { ...pinch, charging: true };
          events.push({ type: 'chargeStart', pos: pinch.pos });
        } else events.push({ type: 'charge', pos: pinch.pos });
        return 'charge';
      }
      return 'pinch';
    }
    endPinch(true);

    // --- fist: hold to toggle pause ---------------------------------------------
    if (h.pose === 'fist') {
      endPoint();
      endRotate();
      fistSince ??= t;
      if (fistArmed) {
        progress = Math.min(1, (t - fistSince) / cfg.fistHold);
        if (t - fistSince >= cfg.fistHold) {
          events.push({ type: 'togglePause' });
          fistArmed = false;
          progress = null;
        }
      }
      return 'fist';
    }
    fistSince = null;
    fistArmed = true;

    // --- point: reticle follows the index fingertip -----------------------------
    if (h.pose === 'point') {
      endRotate();
      if (pointing || t - h.poseSince >= cfg.pointEngage) {
        pointing = true;
        events.push({ type: 'point', pos: h.f.indexTip });
        return 'point';
      }
      progress = (t - h.poseSince) / cfg.pointEngage;
      return 'idle';
    }
    endPoint();

    // --- finger count: filter by attack type --------------------------------------
    // Counts 4/5 double as an open hand, so they only apply when the hand
    // changed into them while still (stopping a rotation never applies one).
    const c = h.count;
    const eligible = c > 0 && !h.countDone && (c <= 3 || (h.countFrom !== null && !h.countMoved));
    if (eligible && h.still) {
      const held = t - h.countSince;
      if (held >= cfg.countHold) {
        events.push({ type: 'count', n: c });
        hands[slot] = { ...h, countDone: true };
      } else if (c <= 3 || mode !== 'rotate') {
        progress = held / cfg.countHold;
        shownCount = c;
      }
    }

    // --- open hand: rotate ------------------------------------------------------------
    const cooling = t - zoomEndedAt < cfg.postZoomCooldown;
    if (h.open && !cooling) {
      if (mode === 'rotate' || t - h.openSince >= cfg.rotateEngage) {
        const speed = Math.hypot(h.vel.x, h.vel.y);
        const k = speed < cfg.velocityDeadzone ? 0 : 1 - cfg.velocityDeadzone / speed;
        events.push({ type: 'rotate', vx: h.vel.x * k, vy: h.vel.y * k });
        return 'rotate';
      }
      progress ??= (t - h.openSince) / cfg.rotateEngage;
      return 'idle';
    }
    endRotate();
    if (c > 0 && c <= 3) {
      shownCount = c;
      return 'count';
    }
    return 'idle';
  }

  const state: GestureState = {
    t,
    hands,
    mode,
    twoHandsSince,
    zoomRef,
    zoomRatio,
    zoomEndedAt,
    pinch,
    pointing,
    fistSince,
    fistArmed,
  };
  return { state, events, indicator: describe(state, n, progress, shownCount) };
}

function describe(
  s: GestureState,
  n: number,
  progress: number | null,
  count: number | undefined,
): Indicator {
  const h = s.hands[0] ?? s.hands[1];
  const labels: Record<GestureMode, string> = {
    zoom: 'Zoom',
    rotate: 'Rotate',
    none: 'No hands',
    point: 'Point',
    pinch: 'Pinch',
    charge: 'Charging',
    fist: s.fistArmed ? 'Fist · hold to pause' : 'Fist',
    count: `Count ${count ?? h?.count ?? ''}`,
    idle: n === 2 ? 'Two hands' : h?.open ? 'Open hand' : 'Hand',
  };
  const ind: Indicator = { mode: s.mode, label: labels[s.mode], hands: n, progress };
  if (count !== undefined) ind.count = count;
  return ind;
}
