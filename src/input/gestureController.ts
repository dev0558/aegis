/**
 * Glue between the tracker and the app: runs the pure HandPipeline on each
 * tracker frame, converts gesture events into Actions and keeps a screen-space
 * snapshot for the overlay and the gesture indicator.
 */
import type { Action } from '../app/actions';
import { viewToScreen, type HandFeatures, type Pt } from './features';
import type { GestureEvent, GestureState, Indicator } from './gestures';
import type { TrackerFrame } from './handTracker';
import { HandPipeline } from './pipeline';

/** Rotation speed per unit of hand speed (rad/s per frame-width/s). */
const YAW_GAIN = 3.2;
const PITCH_GAIN = 2.4;
/** Zoom responds a bit more than linearly to hand spread. */
const ZOOM_EXPONENT = 1.5;

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
  /** Last frame time, ms. */
  t: number;
}

export class GestureController {
  private readonly pipeline = new HandPipeline();
  private zoomAtStart = 1;
  /** Optional tap for the dev landmark recorder. */
  onRawFrame: ((f: TrackerFrame) => void) | null = null;
  snapshot: GestureSnapshot = {
    hands: [],
    indicator: { mode: 'none', label: 'No hands', hands: 0, progress: null },
    mode: 'none',
    zoomBridge: null,
    t: 0,
  };

  constructor(
    private readonly emit: (a: Action) => void,
    private readonly getZoom: () => number,
  ) {}

  /** Release anything held (e.g. when the camera stops). */
  reset(): void {
    if (this.pipeline.state.mode === 'rotate') this.emit({ type: 'rotateRelease' });
    this.pipeline.reset();
    this.snapshot = { ...this.snapshot, hands: [], zoomBridge: null, mode: 'none' };
  }

  onFrame(f: TrackerFrame): void {
    this.onRawFrame?.(f);
    const out = this.pipeline.process(f);
    for (const e of out.events) this.handle(e);

    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const toScreen = (p: Pt) => viewToScreen(p, f.videoWidth, f.videoHeight, sw, sh);
    const hands: OverlayHand[] = [];
    out.smoothed.forEach((sm, i) => {
      const feat = out.features[i];
      if (!sm || !feat) return;
      const points: Pt[] = [];
      for (let k = 0; k < 21; k++) points.push(toScreen({ x: 1 - sm[k * 3]!, y: sm[k * 3 + 1]! }));
      hands.push({ points, features: feat });
    });

    const s = out.state;
    const [h0, h1] = s.hands;
    const zoomBridge: [Pt, Pt] | null =
      s.mode === 'zoom' && h0 && h1 ? [toScreen(h0.f.palm), toScreen(h1.f.palm)] : null;
    const indicator =
      out.indicator.mode === 'zoom'
        ? { ...out.indicator, label: `Zoom ×${this.getZoom().toFixed(2)}` }
        : out.indicator;
    this.snapshot = { hands, indicator, mode: s.mode, zoomBridge, t: f.t };
  }

  private handle(e: GestureEvent): void {
    switch (e.type) {
      case 'rotate': {
        // Slower at high zoom so the surface roughly tracks the hand.
        const z = Math.sqrt(this.getZoom());
        this.emit({
          type: 'rotateVelocity',
          yaw: (e.vx * YAW_GAIN) / z,
          pitch: (e.vy * PITCH_GAIN) / z,
        });
        break;
      }
      case 'rotateEnd':
        this.emit({ type: 'rotateRelease' });
        break;
      case 'zoomStart':
        this.zoomAtStart = this.getZoom();
        break;
      case 'zoom':
        this.emit({ type: 'zoomTo', zoom: this.zoomAtStart * Math.pow(e.ratio, ZOOM_EXPONENT) });
        break;
      case 'zoomEnd':
        break;
    }
  }
}
