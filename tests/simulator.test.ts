import { describe, expect, it } from 'vitest';
import type { Topology } from 'topojson-specification';
import atlas from 'world-atlas/countries-110m.json';
import { COUNTRIES, PAIR_AFFINITY } from '../src/data/countries';
import { decodeCountries } from '../src/data/geo';
import { SimulatedFeed, TECHNIQUES } from '../src/data/simulator';
import { FeedStats } from '../src/data/stats';
import { ATTACK_TYPES, type AttackEvent } from '../src/data/types';

function run(seconds: number, seed = 1): AttackEvent[] {
  const sim = new SimulatedFeed({ seed, now: () => 1_700_000_000_000 });
  const out: AttackEvent[] = [];
  for (let i = 0; i < seconds * 20; i++) out.push(...sim.step(50));
  return out;
}

describe('countries', () => {
  it('uses ISO codes present in world-atlas (except micro-states it omits)', () => {
    const ids = new Set(decodeCountries(atlas as unknown as Topology).map((c) => c.iso));
    const missing = COUNTRIES.filter((c) => !ids.has(c.iso)).map((c) => c.name);
    expect(missing.sort()).toEqual(['Hong Kong', 'Singapore']);
  });

  it('has unique codes and affinity keys that reference known countries', () => {
    const isos = COUNTRIES.map((c) => c.iso);
    expect(new Set(isos).size).toBe(isos.length);
    for (const key of Object.keys(PAIR_AFFINITY)) {
      const [s, t] = key.split('>');
      expect(isos).toContain(s);
      expect(isos).toContain(t);
    }
  });
});

describe('SimulatedFeed', () => {
  const events = run(600);

  it('is deterministic for a given seed', () => {
    const a = run(30, 42).map((e) => `${e.id}${e.source}${e.target}${e.type}${e.technique.id}`);
    const b = run(30, 42).map((e) => `${e.id}${e.source}${e.target}${e.type}${e.technique.id}`);
    expect(a).toEqual(b);
    expect(run(30, 43).length).not.toBe(a.length);
  });

  it('produces a realistic average rate with bursts', () => {
    const rate = events.length / 600;
    expect(rate).toBeGreaterThan(6);
    expect(rate).toBeLessThan(16);
    // Per-second counts should vary well beyond Poisson noise (campaign bursts).
    const perSecond = new Map<number, number>();
    for (const e of events) {
      const s = Math.floor((e.ts - 1_700_000_000_000) / 1000);
      perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
    }
    expect(Math.max(...perSecond.values())).toBeGreaterThan(rate * 2.5);
    expect(events.some((e) => e.campaign)).toBe(true);
  });

  it('never targets the source country', () => {
    expect(events.every((e) => e.source !== e.target)).toBe(true);
  });

  it('attaches a MITRE ATT&CK technique valid for the attack type', () => {
    for (const e of events) {
      expect(e.technique.id).toMatch(/^T\d{4}(\.\d{3})?$/);
      expect(TECHNIQUES[e.type].map((t) => t.id)).toContain(e.technique.id);
    }
  });

  it('only uses RFC 5737 documentation addresses', () => {
    for (const e of events) {
      expect(e.srcIp).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/);
    }
  });

  it('covers every attack type and respects geopolitical affinities', () => {
    for (const t of ATTACK_TYPES) expect(events.some((e) => e.type === t)).toBe(true);
    const fromRu = events.filter((e) => e.source === '643');
    const ruToUa = fromRu.filter((e) => e.target === '804').length / fromRu.length;
    const ruToFr = fromRu.filter((e) => e.target === '250').length / fromRu.length;
    expect(ruToUa).toBeGreaterThan(ruToFr);
  });
});

describe('FeedStats', () => {
  it('tracks totals, events/s and decayed top lists', () => {
    const s = new FeedStats();
    const base = 1_000_000;
    const ev = (src: string, dst: string, ts: number) =>
      ({ source: src, target: dst, type: 'ddos', ts }) as AttackEvent;
    for (let i = 0; i < 10; i++) s.add(ev('156', '840', base + i * 100));
    s.add(ev('643', '804', base + 1000));
    expect(s.total).toBe(11);
    expect(s.byType.ddos).toBe(11);
    expect(s.eps(base + 1000)).toBeCloseTo(11 / 5);
    expect(s.eps(base + 10_000)).toBe(0);
    const top = s.top('source', 5, base + 1000);
    expect(top[0]!.iso).toBe('156');
    expect(s.country('840')?.asTarget).toBe(10);
    expect(s.country('156')?.bySourceType.ddos).toBe(10);
  });
});
