/**
 * Glue between the tracker and the app: runs the pure HandPipeline on each
 * tracker frame, converts gesture events into Actions and keeps a screen-space
 * snapshot for the overlay and the gesture indicator.
 */
import type { Action } from '../app/actions';
import { ATTACK_TYPE_INFO, ATTACK_TYPES, type AttackType } from '../data/types';
import { viewToScreen, type HandFeatures, type Pt } from './features';
import type { GestureEvent, GestureState, Indicator } from './gestures';
import type { TrackerFrame } from './handTracker';
import { HandPipeline } from './pipeline';

/** Rotation speed per unit of hand speed (rad/s per frame-width/s). */
const YAW_GAIN = 3.2;
const PITCH_GAIN = 2.4;
/** Zoom responds a bit more than linearly to hand spread. */
const ZOOM_EXPONENT = 1.5;

/** Finger count → attack-type filter: 1–4 pick a type, 5 shows all. */
export function filterForCount(n: number): AttackType | null {
  return n >= 1 && n <= 4 ? ATTACK_TYPES[n - 1]! : null;
}

export interface OverlayHand {
  /** 21 screen-space points (CSS px). */
  points: Pt[];
  features: HandFeatures;
}

export interface GestureSnapshot {
  hands: OverlayHand[];
  indicator: Indicator;
  mode: GestureState['mode'];
  /** Screen-space palms of the two hands while zooming. */
  zoomBridge: [Pt, Pt] | null;
  /** Reticle position (screen) while pointing or pinching. */
  reticle: Pt | null;
  /** Last frame time, ms. */
  t: number;
}

export interface GestureHost {
  emit(a: Action): void;
  zoom(): number;
  /** Is there a selectable country at this screen point? */
  isTargetAt(p: Pt): boolean;
  /** Current purge charge 0..1 (for the indicator). */
  charge(): number;
}

export class GestureController {
  private readonly pipeline = new HandPipeline();
  private zoomAtStart = 1;
  private toScreen: (p: Pt) => Pt = (p) => p;
  /** Optional tap for the dev landmark recorder. */
  onRawFrame: ((f: TrackerFrame) => void) | null = null;
  snapshot: GestureSnapshot = {
    hands: [],
    indicator: { mode: 'none', label: 'No hands', hands: 0, progress: null },
    mode: 'none',
    zoomBridge: null,
    reticle: null,
    t: 0,
  };

  constructor(private readonly host: GestureHost) {}

  /** Release anything held (e.g. when the camera stops). */
  reset(): void {
    const m = this.pipeline.state.mode;
    if (m === 'rotate') this.host.emit({ type: 'rotateRelease' });
    if (m === 'charge') this.host.emit({ type: 'chargeEnd', commit: false });
    if (this.pipeline.state.pointing) this.host.emit({ type: 'hoverEnd' });
    this.pipeline.reset();
    this.snapshot = { ...this.snapshot, hands: [], zoomBridge: null, reticle: null, mode: 'none' };
  }

  onFrame(f: TrackerFrame): void {
    this.onRawFrame?.(f);
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    this.toScreen = (p: Pt) => viewToScreen(p, f.videoWidth, f.videoHeight, sw, sh);
    const out = this.pipeline.process(f, (p) => this.host.isTargetAt(this.toScreen(p)));

    let reticle: Pt | null = null;
    for (const e of out.events) {
      if (e.type === 'point') reticle = this.toScreen(e.pos);
      this.handle(e);
    }
    if (!out.state.pointing) reticle = null;
    else reticle ??= this.snapshot.reticle;

    const hands: OverlayHand[] = [];
    out.smoothed.forEach((sm, i) => {
      const feat = out.features[i];
      if (!sm || !feat) return;
      const points: Pt[] = [];
      for (let k = 0; k < 21; k++) {
        points.push(this.toScreen({ x: 1 - sm[k * 3]!, y: sm[k * 3 + 1]! }));
      }
      hands.push({ points, features: feat });
    });

    const s = out.state;
    const [h0, h1] = s.hands;
    const zoomBridge: [Pt, Pt] | null =
      s.mode === 'zoom' && h0 && h1 ? [this.toScreen(h0.f.palm), this.toScreen(h1.f.palm)] : null;
    this.snapshot = {
      hands,
      indicator: this.decorate(out.indicator),
      mode: s.mode,
      zoomBridge,
      reticle,
      t: f.t,
    };
  }

  private decorate(ind: Indicator): Indicator {
    switch (ind.mode) {
      case 'zoom':
        return { ...ind, label: `Zoom ×${this.host.zoom().toFixed(2)}` };
      case 'charge':
        return {
          ...ind,
          label: `Charging ${Math.round(this.host.charge() * 100)}%`,
          progress: this.host.charge(),
        };
      default: {
        if (ind.count === undefined) return ind;
        const type = filterForCount(ind.count);
        const what = type ? ATTACK_TYPE_INFO[type].label : 'All types';
        return { ...ind, label: `${ind.count} · ${what}` };
      }
    }
  }

  private handle(e: GestureEvent): void {
    const emit = (a: Action) => {
      this.host.emit(a);
    };
    switch (e.type) {
      case 'rotate': {
        // Slower at high zoom so the surface roughly tracks the hand.
        const z = Math.sqrt(this.host.zoom());
        emit({
          type: 'rotateVelocity',
          yaw: (e.vx * YAW_GAIN) / z,
          pitch: (e.vy * PITCH_GAIN) / z,
        });
        break;
      }
      case 'rotateEnd':
        emit({ type: 'rotateRelease' });
        break;
      case 'zoomStart':
        this.zoomAtStart = this.host.zoom();
        break;
      case 'zoom':
        emit({ type: 'zoomTo', zoom: this.zoomAtStart * Math.pow(e.ratio, ZOOM_EXPONENT) });
        break;
      case 'zoomEnd':
        break;
      case 'point': {
        const p = this.toScreen(e.pos);
        emit({ type: 'hover', x: p.x, y: p.y });
        break;
      }
      case 'pointEnd':
        emit({ type: 'hoverEnd' });
        break;
      case 'select': {
        const p = this.toScreen(e.pos);
        emit({ type: 'select', x: p.x, y: p.y });
        break;
      }
      case 'deselect':
        emit({ type: 'deselect' });
        break;
      case 'chargeStart': {
        const p = this.toScreen(e.pos);
        emit({ type: 'chargeStart', x: p.x, y: p.y });
        break;
      }
      case 'charge': {
        const p = this.toScreen(e.pos);
        emit({ type: 'chargeMove', x: p.x, y: p.y });
        break;
      }
      case 'chargeEnd':
        emit({ type: 'chargeEnd', commit: e.commit });
        break;
      case 'togglePause':
        emit({ type: 'togglePause' });
        break;
      case 'count':
        emit({ type: 'setFilter', filter: filterForCount(e.n) });
        break;
    }
  }
}
