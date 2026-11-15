import { HAND_CONNECTIONS, type Pt } from '../input/features';
import type { GestureSnapshot } from '../input/gestureController';

export interface OverlayFrame {
  /** Latest gesture snapshot (null when the camera is off). */
  snap: GestureSnapshot | null;
  now: number;
  zoom: number;
  /** Purge charge in progress. */
  charge: { x: number; y: number; level: number } | null;
  /** Reticle is over a country. */
  reticleHot: boolean;
  reducedMotion: boolean;
}

interface Wave {
  x: number;
  y: number;
  t0: number;
  s: number;
}

const ICE: [number, number, number] = [128, 215, 255];

/**
 * 2D overlay above the WebGL canvas: hand skeletons, the pointing reticle,
 * the two-hand zoom bridge, the purge charge ring and the purge shockwave
 * (ported from the original prototype). Cleared only when something was drawn.
 */
export class Overlay {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private drewLast = false;
  private waves: Wave[] = [];
  private flash: { t0: number; s: number } | null = null;
  showSkeleton = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drewLast = true;
  }

  /** Trigger the purge shockwave at a screen point. */
  burst(x: number, y: number, strength: number, now: number, reducedMotion: boolean): void {
    this.flash = { t0: now, s: strength };
    if (reducedMotion) return;
    this.waves.push({ x, y, t0: now, s: strength }, { x, y, t0: now + 80, s: strength * 0.6 });
  }

  draw(o: OverlayFrame): void {
    const snap = o.snap && o.now - o.snap.t <= 350 ? o.snap : null;
    const wantHands = !!snap && this.showSkeleton && snap.hands.length > 0;
    const wantBridge = !!snap?.zoomBridge;
    const wantReticle = !!snap?.reticle && !o.charge;
    const wantFx = this.waves.length > 0 || this.flash !== null || o.charge !== null;
    if (!wantHands && !wantBridge && !wantReticle && !wantFx) {
      if (this.drewLast) {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        this.drewLast = false;
      }
      return;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.drewLast = true;

    if (wantFx) this.drawFx(o.now);
    if (wantHands) this.drawHands(snap.hands);
    if (wantBridge) this.drawBridge(snap.zoomBridge!, o.zoom);
    if (wantReticle) this.drawReticle(snap.reticle!, o.reticleHot, o.now);
    if (o.charge) this.drawCharge(o.charge, o.now, o.reducedMotion);
  }

  private drawHands(hands: GestureSnapshot['hands']): void {
    const ctx = this.ctx;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(235,231,223,0.24)';
    for (const h of hands) {
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const pa = h.points[a]!;
        const pb = h.points[b]!;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(235,231,223,0.85)';
      for (const i of [4, 8, 12, 16, 20]) {
        const p = h.points[i]!;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBridge([a, b]: [Pt, Pt], zoom: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = 'rgba(235,231,223,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(235,231,223,0.8)';
    ctx.font = 'italic 18px "Cormorant Garamond", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(`×${zoom.toFixed(2)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14);
    ctx.restore();
  }

  private drawReticle(p: Pt, hot: boolean, now: number): void {
    const ctx = this.ctx;
    const r = hot ? 15 + Math.sin(now / 160) * 1.5 : 13;
    ctx.save();
    ctx.strokeStyle = hot ? 'rgba(128,215,255,0.95)' : 'rgba(235,231,223,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      ctx.moveTo(p.x + dx * (r + 3), p.y + dy * (r + 3));
      ctx.lineTo(p.x + dx * (r + 8), p.y + dy * (r + 8));
    }
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCharge(c: { x: number; y: number; level: number }, now: number, reduced: boolean) {
    const ctx = this.ctx;
    const [r, g, b] = ICE;
    const R = 30;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(235,231,223,0.18)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.95)`;
    ctx.shadowColor = `rgb(${r},${g},${b})`;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, -Math.PI / 2, -Math.PI / 2 + c.level * Math.PI * 2);
    ctx.stroke();
    if (c.level >= 1) {
      const pulse = reduced ? 0.5 : (Math.sin(now / 100) + 1) / 2;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.25 + pulse * 0.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, R + 7 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(235,231,223,0.9)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawFx(now: number): void {
    const ctx = this.ctx;
    const [r, g, b] = ICE;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (this.flash) {
      const a = (now - this.flash.t0) / 1000;
      if (a > 0.35) this.flash = null;
      else {
        ctx.fillStyle = `rgba(${r},${g},${b},${0.14 * this.flash.s * (1 - a / 0.35)})`;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }
    this.waves = this.waves.filter((w) => (now - w.t0) / 1000 <= 1.1);
    for (const w of this.waves) {
      const a = (now - w.t0) / 1000;
      if (a < 0) continue;
      const k = a / 1.1;
      ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - k) * (1 - k) * 0.8})`;
      ctx.lineWidth = 2.5 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(w.x, w.y, 30 + a * (900 + 1400 * w.s), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
