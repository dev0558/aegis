import { HAND_CONNECTIONS } from '../input/features';
import type { GestureSnapshot } from '../input/gestureController';

/**
 * 2D overlay above the WebGL canvas: hand skeletons and gesture affordances
 * (two-hand zoom bridge). Cleared only when something was drawn.
 */
export class Overlay {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private drewLast = false;
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

  draw(snap: GestureSnapshot | null, nowMs: number, zoom: number): void {
    const stale = !snap || nowMs - snap.t > 350;
    const wantHands = !stale && this.showSkeleton && snap.hands.length > 0;
    const wantBridge = !stale && snap.zoomBridge !== null;
    if (!wantHands && !wantBridge) {
      if (this.drewLast) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drewLast = false;
      }
      return;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drewLast = true;

    if (wantHands) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(235,231,223,0.24)';
      for (const h of snap.hands) {
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

    if (wantBridge) {
      const [a, b] = snap.zoomBridge!;
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
  }
}
