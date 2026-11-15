/**
 * Rolling feed statistics: events/second, totals, exponentially-decayed
 * per-country scores (for "top" lists and globe heat), and per-country
 * breakdowns for tooltips.
 */
import { ATTACK_TYPES, type AttackEvent, type AttackType, type CountryCode } from './types';

const EPS_WINDOW_MS = 5000;
/** Time constant for "top" rankings (ms). */
const TOP_TAU = 60_000;
/** Faster time constant for globe heat (ms). */
const HEAT_TAU = 15_000;

class Decayed {
  private value = 0;
  private at = 0;
  constructor(private readonly tau: number) {}
  add(now: number, amount = 1): void {
    this.value = this.get(now) + amount;
    this.at = now;
  }
  get(now: number): number {
    return this.value * Math.exp(-(now - this.at) / this.tau);
  }
}

export interface CountryStats {
  asSource: number;
  asTarget: number;
  bySourceType: Record<AttackType, number>;
  byTargetType: Record<AttackType, number>;
  lastSeen: number;
}

const zeroTypes = (): Record<AttackType, number> =>
  Object.fromEntries(ATTACK_TYPES.map((t) => [t, 0])) as Record<AttackType, number>;

export class FeedStats {
  total = 0;
  readonly byType: Record<AttackType, number> = zeroTypes();
  private readonly recent: number[] = [];
  private readonly srcTop = new Map<CountryCode, Decayed>();
  private readonly dstTop = new Map<CountryCode, Decayed>();
  private readonly heat = new Map<CountryCode, Decayed>();
  private readonly countries = new Map<CountryCode, CountryStats>();

  add(e: AttackEvent, now: number = e.ts): void {
    this.total++;
    this.byType[e.type]++;
    this.recent.push(now);
    bump(this.srcTop, e.source, TOP_TAU, now);
    bump(this.dstTop, e.target, TOP_TAU, now);
    bump(this.heat, e.target, HEAT_TAU, now);
    const s = this.country(e.source, true);
    s.asSource++;
    s.bySourceType[e.type]++;
    s.lastSeen = now;
    const d = this.country(e.target, true);
    d.asTarget++;
    d.byTargetType[e.type]++;
    d.lastSeen = now;
  }

  /** Events per second over the trailing window. */
  eps(now: number): number {
    const cutoff = now - EPS_WINDOW_MS;
    let i = 0;
    while (i < this.recent.length && this.recent[i]! < cutoff) i++;
    if (i) this.recent.splice(0, i);
    return this.recent.length / (EPS_WINDOW_MS / 1000);
  }

  top(kind: 'source' | 'target', n: number, now: number): { iso: CountryCode; score: number }[] {
    const m = kind === 'source' ? this.srcTop : this.dstTop;
    return [...m]
      .map(([iso, d]) => ({ iso, score: d.get(now) }))
      .filter((r) => r.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  /** Decayed attack intensity per target country. */
  heatEntries(now: number): [CountryCode, number][] {
    return [...this.heat].map(([iso, d]) => [iso, d.get(now)]);
  }

  country(iso: CountryCode): CountryStats | undefined;
  country(iso: CountryCode, create: true): CountryStats;
  country(iso: CountryCode, create = false): CountryStats | undefined {
    let s = this.countries.get(iso);
    if (!s && create) {
      s = {
        asSource: 0,
        asTarget: 0,
        bySourceType: zeroTypes(),
        byTargetType: zeroTypes(),
        lastSeen: 0,
      };
      this.countries.set(iso, s);
    }
    return s;
  }
}

function bump(m: Map<CountryCode, Decayed>, iso: CountryCode, tau: number, now: number): void {
  let d = m.get(iso);
  if (!d) {
    d = new Decayed(tau);
    m.set(iso, d);
  }
  d.add(now);
}
