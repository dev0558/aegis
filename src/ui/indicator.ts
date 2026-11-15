import type { Indicator } from '../input/gestures';

/** Small bottom-centre chip that always shows what the recognizer sees. */
export class GestureIndicator {
  private readonly label: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly bar: HTMLElement;
  private key = '';

  constructor(private readonly el: HTMLElement) {
    this.label = el.querySelector('.ind-label')!;
    this.meta = el.querySelector('.ind-meta')!;
    this.bar = el.querySelector('.ind-bar > span')!;
  }

  setVisible(v: boolean): void {
    this.el.hidden = !v;
  }

  update(ind: Indicator, stale: boolean, hz: number, backend: string): void {
    const mode = stale ? 'none' : ind.mode;
    const label = stale ? 'No hands' : ind.label;
    const meta = `${Math.round(hz)} Hz · ${backend}`;
    const progress = !stale && ind.progress !== null ? Math.min(1, ind.progress) : null;
    const key = `${mode}|${label}|${meta}|${progress === null ? '' : progress.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    this.el.dataset['mode'] = mode;
    this.label.textContent = label;
    this.meta.textContent = meta;
    this.bar.parentElement!.hidden = progress === null;
    if (progress !== null) this.bar.style.transform = `scaleX(${progress})`;
  }
}
