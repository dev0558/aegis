/**
 * DOM-free hand pipeline: stable slot assignment → One Euro smoothing →
 * feature extraction → gesture reducer. Used live by GestureController and
 * offline by tests replaying recorded landmark fixtures.
 */
import { extractFeatures, type HandFeatures, type Pt } from './features';
import { initialGestureState, stepGestures, type GestureState } from './gestures';
import { VectorOneEuro } from './oneEuro';
import type { RawHand } from './trackerProtocol';

const SLOT_RESET_GAP = 0.3; // s without a hand before its filter restarts

export interface PipelineFrame {
  /** ms, monotonic */
  t: number;
  hands: readonly Pick<RawHand, 'landmarks'>[];
  videoWidth: number;
  videoHeight: number;
}

interface Slot {
  filter: VectorOneEuro;
  smoothed: Float32Array;
  lastSeen: number;
  wrist: Pt;
}

const newSlot = (): Slot => ({
  filter: new VectorOneEuro(63),
  smoothed: new Float32Array(63),
  lastSeen: -Infinity,
  wrist: { x: 0.5, y: 0.5 },
});

export class HandPipeline {
  state: GestureState = initialGestureState();
  private readonly slots: [Slot, Slot] = [newSlot(), newSlot()];

  reset(): void {
    this.state = initialGestureState();
    for (const s of this.slots) {
      s.filter.reset();
      s.lastSeen = -Infinity;
    }
  }

  /**
   * @param isTarget optional hit test (view-space point → is there a selectable
   *                 target, e.g. a country?) used to decide tap-select vs charge.
   */
  process(f: PipelineFrame, isTarget?: (p: Pt) => boolean) {
    const t = f.t / 1000;
    const aspect = f.videoWidth / Math.max(1, f.videoHeight);
    const assigned = this.assign(f.hands, t);
    const features: [HandFeatures | null, HandFeatures | null] = [null, null];
    const smoothed: [Float32Array | null, Float32Array | null] = [null, null];
    assigned.forEach((lm, i) => {
      if (!lm) return;
      const slot = this.slots[i]!;
      if (t - slot.lastSeen > SLOT_RESET_GAP) slot.filter.reset();
      slot.lastSeen = t;
      const sm = slot.filter.filter(lm, t, slot.smoothed);
      slot.wrist = { x: 1 - sm[0]!, y: sm[1]! };
      smoothed[i] = sm;
      features[i] = extractFeatures(sm, aspect);
    });
    const targets: [boolean, boolean] = [
      !!(features[0] && isTarget?.(features[0].pinchPoint)),
      !!(features[1] && isTarget?.(features[1].pinchPoint)),
    ];
    const out = stepGestures(this.state, { t, aspect, hands: features, targets });
    this.state = out.state;
    return { ...out, smoothed, features };
  }

  /** Match detections to slots by nearest wrist so filters/hysteresis stay per-hand. */
  private assign(
    hands: readonly Pick<RawHand, 'landmarks'>[],
    t: number,
  ): [ArrayLike<number> | null, ArrayLike<number> | null] {
    const live = this.slots.map((s) => t - s.lastSeen <= SLOT_RESET_GAP);
    const wrist = (lm: ArrayLike<number>): Pt => ({ x: 1 - lm[0]!, y: lm[1]! });
    const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const [h0, h1] = hands;
    if (h0 && h1) {
      const a = h0.landmarks;
      const b = h1.landmarks;
      if (live[0] && live[1]) {
        const keep = d(wrist(a), this.slots[0].wrist) + d(wrist(b), this.slots[1].wrist);
        const swap = d(wrist(a), this.slots[1].wrist) + d(wrist(b), this.slots[0].wrist);
        return swap < keep ? [b, a] : [a, b];
      }
      // Fresh pair: order left-to-right on screen for determinism.
      return wrist(a).x <= wrist(b).x ? [a, b] : [b, a];
    }
    if (h0) {
      const a = h0.landmarks;
      if (live[0] && live[1]) {
        return d(wrist(a), this.slots[0].wrist) <= d(wrist(a), this.slots[1].wrist)
          ? [a, null]
          : [null, a];
      }
      return live[1] && !live[0] ? [null, a] : [a, null];
    }
    return [null, null];
  }
}
