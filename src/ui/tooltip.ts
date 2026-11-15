export interface TooltipContent {
  name: string;
  meta: string;
  rows?: [label: string, value: string][];
  hint?: string;
}

/** Small glass tooltip that follows a screen point, clamped to the viewport. */
export class Tooltip {
  private visible = false;
  private key = '';

  constructor(private readonly el: HTMLElement) {}

  show(x: number, y: number, c: TooltipContent): void {
    const key = JSON.stringify(c);
    if (key !== this.key) {
      this.key = key;
      const children: HTMLElement[] = [div('t-name', c.name), div('t-meta', c.meta)];
      if (c.rows?.length) {
        const grid = div('t-rows', '');
        for (const [label, value] of c.rows) {
          const b = document.createElement('b');
          b.textContent = value;
          grid.append(span(label), b);
        }
        children.push(grid);
      }
      if (c.hint) children.push(div('t-hint', c.hint));
      this.el.replaceChildren(...children);
    }
    if (!this.visible) {
      this.el.hidden = false;
      this.visible = true;
    }
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let tx = x + 22;
    let ty = y + 22;
    if (tx + w > window.innerWidth - 8) tx = x - w - 22;
    if (ty + h > window.innerHeight - 8) ty = y - h - 22;
    this.el.style.transform = `translate3d(${Math.round(Math.max(8, tx))}px, ${Math.round(Math.max(8, ty))}px, 0)`;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.hidden = true;
  }
}

function div(cls: string, text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}

function span(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}
