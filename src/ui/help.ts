export interface HelpRow {
  action: string;
  gesture: string;
  keys: string; // may contain <kbd> markup built by `k()`
}

/** Rows shown in the help sheet. Extended as features land. */
export const HELP_ROWS: HelpRow[] = [
  {
    action: 'Rotate',
    gesture: 'One open hand, move it',
    keys: `Drag · ${k('←')} ${k('→')} ${k('↑')} ${k('↓')}`,
  },
  {
    action: 'Zoom',
    gesture: 'Two hands: spread / bring together',
    keys: `Wheel · trackpad pinch · ${k('+')} ${k('−')}`,
  },
  { action: 'Reset view', gesture: '—', keys: k('0') },
  { action: 'Inspect country', gesture: 'Point with index finger', keys: 'Hover' },
  { action: 'Help', gesture: '—', keys: `${k('?')} · ${k('Esc')} to close` },
];

function k(key: string): string {
  return `<kbd>${key}</kbd>`;
}

export class HelpSheet {
  private readonly sheet: HTMLElement;
  private lastFocus: Element | null = null;

  constructor(rows: HelpRow[]) {
    this.sheet = document.getElementById('help')!;
    const body = document.getElementById('helpRows')!;
    for (const r of rows) {
      const tr = document.createElement('tr');
      const a = document.createElement('td');
      a.textContent = r.action;
      const g = document.createElement('td');
      g.textContent = r.gesture;
      const kk = document.createElement('td');
      kk.innerHTML = r.keys; // static, author-controlled markup
      tr.append(a, g, kk);
      body.append(tr);
    }
    document.getElementById('helpClose')!.addEventListener('click', () => {
      this.close();
    });
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.sheet.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.lastFocus = document.activeElement;
    this.sheet.hidden = false;
    document.getElementById('helpClose')!.focus();
  }

  close(): void {
    this.sheet.hidden = true;
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus();
  }
}
