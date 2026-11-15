/** Bottom-left live stats. Writes are throttled and skipped when unchanged. */
export class Hud {
  private readonly els: Record<string, HTMLElement> = {};
  private readonly last: Record<string, string> = {};

  constructor(ids: string[]) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing HUD element #${id}`);
      this.els[id] = el;
    }
  }

  set(id: string, text: string): void {
    if (this.last[id] === text) return;
    this.last[id] = text;
    const el = this.els[id];
    if (el) el.textContent = text;
  }
}

/** Frame-time meter averaged over ~0.5s windows. */
export class FpsMeter {
  private frames = 0;
  private acc = 0;
  fps = 60;
  /** Returns true when a new average is available. */
  tick(dt: number): boolean {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return false;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    return true;
  }
}
