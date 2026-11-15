export interface HelpRow {
  action: string;
  gesture: string;
  keys: string; // may contain <kbd> markup built by `k()`
}

/** Rows shown in the help sheet. Extended as features land. */
export const HELP_ROWS: HelpRow[] = [
  {
    action: 'Rotate',
    gesture: 'One open hand: move it (flick and drop for inertia)',
    keys: `Drag · ${k('←')} ${k('→')} ${k('↑')} ${k('↓')}`,
  },
  {
    action: 'Zoom',
    gesture: 'Two hands: spread apart / bring together',
    keys: `Wheel · trackpad pinch · ${k('+')} ${k('−')}`,
  },
  {
    action: 'Inspect country',
    gesture: 'Point with your index finger (thumb tucked)',
    keys: 'Hover',
  },
  {
    action: 'Select country',
    gesture: 'Quick pinch on a country · pinch empty space to clear',
    keys: `Click · ${k('Esc')} to clear`,
  },
  {
    action: 'Purge',
    gesture: 'Pinch and hold on empty space, release to fire',
    keys: `Hold on empty space · hold ${k('Space')}`,
  },
  {
    action: 'Pause feed',
    gesture: 'Make a fist and hold for 1 s',
    keys: `${k('P')} · Pause button`,
  },
  {
    action: 'Filter by type',
    gesture:
      'Count from the thumb, hold still 0.4 s: 1 DDoS · 2 Brute force · 3 Malware C2 · 4 Phishing · 5 All',
    keys: `${k('1')}–${k('4')} · ${k('5')} all · ${k('6')} port scan · click the legend`,
  },
  { action: 'Reset view', gesture: '—', keys: k('0') },
  { action: 'Event log', gesture: '—', keys: k('L') },
  { action: 'Webcam background', gesture: '—', keys: `${k('B')} · Webcam button` },
  { action: 'Hand skeleton', gesture: '—', keys: `${k('H')} · Hands button` },
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
