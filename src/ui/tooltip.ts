/** Small glass tooltip that follows a screen point, clamped to the viewport. */
export class Tooltip {
  private visible = false;
  private key = '';

  constructor(private readonly el: HTMLElement) {}

  show(x: number, y: number, name: string, meta: string): void {
    const key = name + '|' + meta;
    if (key !== this.key) {
      this.key = key;
      this.el.replaceChildren(div('t-name', name), div('t-meta', meta));
    }
    if (!this.visible) {
      this.el.hidden = false;
      this.visible = true;
    }
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let tx = x + 18;
    let ty = y + 18;
    if (tx + w > window.innerWidth - 8) tx = x - w - 18;
    if (ty + h > window.innerHeight - 8) ty = y - h - 18;
    this.el.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
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
