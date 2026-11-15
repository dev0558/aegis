import { countryInfo } from '../data/countries';
import type { FeedStats } from '../data/stats';
import { ATTACK_TYPE_INFO, ATTACK_TYPES, type AttackEvent, type AttackType } from '../data/types';

const MAX_ROWS = 60;
const TOP_N = 5;
const STORAGE_KEY = 'aegis.panelOpen';

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Right-hand panel: attack-type legend, top sources/targets and a live event
 * log. Incoming events are queued and flushed in batches so DOM work stays
 * small and off the hot path.
 */
export class Panel {
  readonly root: HTMLElement;
  private readonly log: HTMLOListElement;
  private readonly topSrc: HTMLOListElement;
  private readonly topDst: HTMLOListElement;
  private readonly typeCounts = new Map<AttackType, HTMLElement>();
  private readonly state: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly filterNote: HTMLElement;
  private readonly legendItems = new Map<AttackType, HTMLButtonElement>();
  private queue: (AttackEvent | string)[] = [];
  private typeFilter: AttackType | null = null;
  private country: { iso: string; name: string } | null = null;
  private _open: boolean;
  onToggle: (open: boolean) => void = () => undefined;
  /** Legend click: toggle a type filter. */
  onTypeClick: (t: AttackType) => void = () => undefined;
  onClearCountry: () => void = () => undefined;

  constructor(root: HTMLElement) {
    this.root = root;
    const head = el('header', 'panel-head');
    const title = el('div', 'panel-title', 'Live feed');
    this.state = el('span', 'feed-state', 'Live');
    this.toggleBtn = el('button', 'panel-toggle ghost');
    this.toggleBtn.type = 'button';
    this.toggleBtn.setAttribute('aria-controls', 'panelBody');
    this.toggleBtn.addEventListener('click', () => {
      this.setOpen(!this._open);
    });
    head.append(title, this.state, this.toggleBtn);

    const body = el('div', 'panel-body');
    body.id = 'panelBody';

    const legend = el('ul', 'legend');
    legend.setAttribute('aria-label', 'Attack types (click to filter)');
    for (const t of ATTACK_TYPES) {
      const info = ATTACK_TYPE_INFO[t];
      const li = el('li');
      const btn = el('button', 'legend-item');
      btn.type = 'button';
      btn.dataset['type'] = t;
      btn.setAttribute('aria-pressed', 'false');
      btn.title = `Show only ${info.label}`;
      btn.addEventListener('click', () => {
        this.onTypeClick(t);
      });
      const dot = el('i', 'dot');
      dot.style.setProperty('--c', info.color);
      const count = el('b', '', '0');
      this.typeCounts.set(t, count);
      btn.append(dot, el('span', '', info.label), count);
      li.append(btn);
      this.legendItems.set(t, btn);
      legend.append(li);
    }
    this.filterNote = el('div', 'filter-note');
    this.filterNote.hidden = true;
    this.filterNote.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.onClearCountry();
    });

    this.topSrc = el('ol', 'top');
    this.topDst = el('ol', 'top');
    const tops = el('div', 'tops');
    const srcCol = el('section');
    srcCol.append(el('h3', '', 'Top sources'), this.topSrc);
    const dstCol = el('section');
    dstCol.append(el('h3', '', 'Top targets'), this.topDst);
    tops.append(srcCol, dstCol);

    this.log = el('ol', 'log');
    this.log.setAttribute('aria-live', 'off');
    const logSec = el('section', 'log-sec');
    logSec.append(el('h3', '', 'Event log'), this.log);

    body.append(legend, this.filterNote, tops, logSec);
    root.append(head, body);

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage unavailable (private mode etc.)
    }
    const narrow = window.matchMedia('(max-width: 760px)').matches;
    this._open = stored === null ? !narrow : stored === '1';
    this.apply();
  }

  get open(): boolean {
    return this._open;
  }

  setOpen(open: boolean): void {
    this._open = open;
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {
      // ignore
    }
    this.apply();
    this.onToggle(open);
  }

  private apply(): void {
    this.root.classList.toggle('collapsed', !this._open);
    this.toggleBtn.textContent = this._open ? 'Hide' : 'Log';
    this.toggleBtn.setAttribute('aria-expanded', String(this._open));
    this.toggleBtn.title = this._open ? 'Hide panel (L)' : 'Show live feed (L)';
  }

  setPaused(paused: boolean): void {
    this.state.textContent = paused ? 'Paused' : 'Live';
    this.state.classList.toggle('paused', paused);
  }

  private matches = (e: AttackEvent): boolean =>
    (this.typeFilter === null || e.type === this.typeFilter) &&
    (this.country === null || e.source === this.country.iso || e.target === this.country.iso);

  /** Show only one attack type (null = all). */
  setTypeFilter(t: AttackType | null): void {
    this.typeFilter = t;
    for (const [type, btn] of this.legendItems) {
      const on = t === null || t === type;
      btn.classList.toggle('off', !on);
      btn.setAttribute('aria-pressed', String(t === type));
    }
    this.resetLog();
  }

  /** Restrict the log to one country (null = all). */
  setCountry(c: { iso: string; name: string } | null): void {
    this.country = c;
    this.filterNote.hidden = !c;
    this.resetLog();
  }

  /** Add a system line (e.g. "Purged 37 arcs") to the log. */
  note(text: string): void {
    this.queue.push(text);
  }

  private resetLog(): void {
    // New filter: the log restarts with matching events from here on.
    this.log.replaceChildren();
    this.queue = [];
  }

  private renderCountryNote(stats: FeedStats): void {
    if (!this.country) return;
    const s = stats.country(this.country.iso);
    const name = el('span', 'fn-name', this.country.name);
    const meta = el(
      'span',
      'fn-meta',
      s ? `${s.asTarget} in · ${s.asSource} out` : 'No activity yet',
    );
    const clear = el('button', 'ghost fn-clear', 'Clear');
    clear.type = 'button';
    clear.title = 'Clear selection (Esc)';
    this.filterNote.replaceChildren(name, meta, clear);
  }

  push(e: AttackEvent): void {
    if (!this.matches(e)) return;
    this.queue.push(e);
    if (this.queue.length > MAX_ROWS) this.queue.splice(0, this.queue.length - MAX_ROWS);
  }

  /** Apply queued events and refresh aggregates. Call a few times per second. */
  flush(stats: FeedStats, now: number): void {
    for (const t of ATTACK_TYPES) {
      this.typeCounts.get(t)!.textContent = stats.byType[t].toLocaleString('en-US');
    }
    if (!this._open) return;
    this.renderCountryNote(stats);
    const rows = this.queue;
    this.queue = [];
    if (rows.length) {
      const frag = document.createDocumentFragment();
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        frag.append(typeof r === 'string' ? this.systemRow(r) : this.row(r));
      }
      this.log.prepend(frag);
      while (this.log.childElementCount > MAX_ROWS) this.log.lastElementChild!.remove();
    }
    this.renderTop(this.topSrc, stats.top('source', TOP_N, now));
    this.renderTop(this.topDst, stats.top('target', TOP_N, now));
  }

  private renderTop(list: HTMLOListElement, rows: { iso: string; score: number }[]): void {
    const max = rows[0]?.score ?? 1;
    const items = rows.map((r) => {
      const li = el('li');
      const name = countryInfo(r.iso)?.name ?? r.iso;
      const bar = el('span', 'bar');
      bar.style.setProperty('--w', String(r.score / max));
      li.append(el('span', 'name', name), bar);
      li.title = `${name}: ${r.score.toFixed(1)} (decayed, last ~60 s)`;
      return li;
    });
    list.replaceChildren(...items);
  }

  private systemRow(text: string): HTMLLIElement {
    const li = el('li', 'system');
    li.append(
      el('i', 'dot'),
      el('span', 'route', text),
      el('time', '', timeFmt.format(Date.now())),
    );
    return li;
  }

  private row(e: AttackEvent): HTMLLIElement {
    const info = ATTACK_TYPE_INFO[e.type];
    const src = countryInfo(e.source);
    const dst = countryInfo(e.target);
    const li = el('li', `sev-${e.severity}`);
    const dot = el('i', 'dot');
    dot.style.setProperty('--c', info.color);
    const route = el('span', 'route', `${src?.a2 ?? e.source} → ${dst?.a2 ?? e.target}`);
    const tech = el('span', 'tech', e.technique.id);
    const time = el('time', '', timeFmt.format(e.ts));
    time.dateTime = new Date(e.ts).toISOString();
    const line2 = el(
      'span',
      'detail',
      `${info.label} · :${e.dstPort} · ${e.srcIp}${e.campaign ? ` · ${e.campaign}` : ''}`,
    );
    li.append(dot, route, tech, time, line2);
    li.title = `${src?.name ?? e.source} → ${dst?.name ?? e.target}\n${e.technique.id} ${e.technique.name}\nSeverity: ${e.severity}`;
    return li;
  }
}
