/**
 * Simulated threat feed.
 *
 * Arrival model: a baseline Poisson process (with a slow, wandering rate)
 * plus "campaigns": coordinated bursts with a fixed source, attack type and
 * often a fixed target, running at several times the base rate for a few
 * seconds. Country pairs are drawn from source/target weights multiplied by
 * directed geopolitical affinities. Every event carries a MITRE ATT&CK
 * technique appropriate to its type.
 *
 * Source IPs are drawn only from the RFC 5737 documentation ranges, so no
 * real host is ever implicated.
 *
 * `step(dtMs)` is deterministic for a given seed, which the tests rely on.
 */
import { COUNTRIES, DEFAULT_MIX, PAIR_AFFINITY, type CountryInfo } from './countries';
import { mulberry32, type Rng } from '../util/prng';
import {
  ATTACK_TYPES,
  type AttackEvent,
  type AttackType,
  type Severity,
  type Technique,
  type ThreatFeed,
} from './types';

export const TECHNIQUES: Record<AttackType, readonly (Technique & { w: number })[]> = {
  ddos: [
    { id: 'T1498.001', name: 'Direct Network Flood', w: 4 },
    { id: 'T1498.002', name: 'Reflection Amplification', w: 3 },
    { id: 'T1499.002', name: 'Service Exhaustion Flood', w: 2 },
    { id: 'T1499.003', name: 'Application Exhaustion Flood', w: 1 },
  ],
  bruteforce: [
    { id: 'T1110.001', name: 'Password Guessing', w: 4 },
    { id: 'T1110.003', name: 'Password Spraying', w: 3 },
    { id: 'T1110.004', name: 'Credential Stuffing', w: 3 },
  ],
  c2: [
    { id: 'T1071.001', name: 'Application Layer Protocol: Web Protocols', w: 5 },
    { id: 'T1071.004', name: 'Application Layer Protocol: DNS', w: 2 },
    { id: 'T1573.002', name: 'Encrypted Channel: Asymmetric Cryptography', w: 2 },
    { id: 'T1105', name: 'Ingress Tool Transfer', w: 2 },
    { id: 'T1090.002', name: 'Proxy: External Proxy', w: 1 },
  ],
  phishing: [
    { id: 'T1566.001', name: 'Spearphishing Attachment', w: 4 },
    { id: 'T1566.002', name: 'Spearphishing Link', w: 5 },
    { id: 'T1566.003', name: 'Spearphishing via Service', w: 1 },
    { id: 'T1598.003', name: 'Phishing for Information: Spearphishing Link', w: 2 },
  ],
  portscan: [
    { id: 'T1046', name: 'Network Service Discovery', w: 3 },
    { id: 'T1595.001', name: 'Active Scanning: Scanning IP Blocks', w: 4 },
    { id: 'T1595.002', name: 'Active Scanning: Vulnerability Scanning', w: 3 },
  ],
};

const PORTS: Record<AttackType, readonly number[]> = {
  ddos: [80, 443, 443, 53, 123, 1900, 11211],
  bruteforce: [22, 22, 22, 3389, 3389, 445, 21, 23, 5900, 1433, 3306],
  c2: [443, 443, 443, 8443, 8080, 53, 4444, 1337],
  phishing: [25, 587, 465, 443],
  portscan: [22, 23, 80, 443, 445, 3389, 5432, 6379, 8080, 9200, 27017, 2375],
};

const SEVERITY: Record<AttackType, readonly [Severity, number][]> = {
  ddos: [['medium', 4], ['high', 4], ['critical', 1]],
  bruteforce: [['low', 3], ['medium', 5], ['high', 2]],
  c2: [['medium', 2], ['high', 5], ['critical', 3]],
  phishing: [['low', 2], ['medium', 5], ['high', 3]],
  portscan: [['low', 7], ['medium', 3]],
}; // prettier-ignore

const TEST_NETS = ['192.0.2', '198.51.100', '203.0.113'] as const;

const CODENAME_A = [
  'Quiet',
  'Glass',
  'Ember',
  'Hollow',
  'Iron',
  'Pale',
  'Velvet',
  'Static',
  'Amber',
  'Cold',
  'Silent',
  'Copper',
  'Ashen',
  'Distant',
];
const CODENAME_B = ['Harbor', 'Lattice', 'Meridian', 'Orchard', 'Signal', 'Canal', 'Spire', 'Tide', 'Lantern', 'Quarry', 'Vector', 'Thicket', 'Relay', 'Cinder']; // prettier-ignore

interface Campaign {
  name: string;
  type: AttackType;
  source: CountryInfo;
  target: CountryInfo | null;
  rate: number; // events per second
  endsAt: number; // sim seconds
  subnet: string;
}

export interface SimulatorOptions {
  seed: number;
  /** Mean baseline events per second. */
  baseRate: number;
  /** Mean campaigns started per second. */
  campaignRate: number;
  maxCampaigns: number;
  /** Wall clock for event timestamps. */
  now: () => number;
  /** Emission tick in ms (only used by start()). */
  tickMs: number;
}

const DEFAULTS: SimulatorOptions = {
  seed: 0x5eed,
  baseRate: 5,
  campaignRate: 1 / 14,
  maxCampaigns: 2,
  now: () => Date.now(),
  tickMs: 50,
};

type Weighted<T> = { items: T[]; cum: number[] };

function weighted<T>(pairs: [T, number][]): Weighted<T> {
  const items: T[] = [];
  const cum: number[] = [];
  let acc = 0;
  for (const [item, w] of pairs) {
    if (w <= 0) continue;
    acc += w;
    items.push(item);
    cum.push(acc);
  }
  return { items, cum };
}

function pick<T>(w: Weighted<T>, rng: Rng): T {
  const r = rng() * w.cum[w.cum.length - 1]!;
  let lo = 0;
  let hi = w.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (w.cum[mid]! < r) lo = mid + 1;
    else hi = mid;
  }
  return w.items[lo]!;
}

/** Knuth's algorithm; fine for the small λ used per tick. */
function poisson(lambda: number, rng: Rng): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export class SimulatedFeed implements ThreatFeed {
  readonly name = 'Simulated feed';
  private readonly o: SimulatorOptions;
  private readonly rng: Rng;
  private readonly sources: Weighted<CountryInfo>;
  private readonly targetsBySource = new Map<string, Weighted<CountryInfo>>();
  private readonly mixBySource = new Map<string, Weighted<AttackType>>();
  private readonly techniques: Record<AttackType, Weighted<Technique>>;
  private readonly severities: Record<AttackType, Weighted<Severity>>;
  private readonly listeners = new Set<(e: AttackEvent) => void>();
  private campaigns: Campaign[] = [];
  private simTime = 0;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private _paused = false;

  constructor(opts: Partial<SimulatorOptions> = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.rng = mulberry32(this.o.seed);
    this.sources = weighted(COUNTRIES.map((c) => [c, c.src]));
    for (const s of COUNTRIES) {
      this.targetsBySource.set(
        s.iso,
        weighted(
          COUNTRIES.filter((t) => t !== s).map((t) => [
            t,
            t.dst * (PAIR_AFFINITY[`${s.iso}>${t.iso}`] ?? 1),
          ]),
        ),
      );
      const mix = s.mix ?? DEFAULT_MIX;
      this.mixBySource.set(s.iso, weighted(ATTACK_TYPES.map((ty) => [ty, mix[ty] ?? 0])));
    }
    this.techniques = Object.fromEntries(
      ATTACK_TYPES.map((ty) => [
        ty,
        weighted(TECHNIQUES[ty].map(({ id, name, w }) => [{ id, name }, w])),
      ]),
    ) as Record<AttackType, Weighted<Technique>>;
    this.severities = Object.fromEntries(
      ATTACK_TYPES.map((ty) => [ty, weighted([...SEVERITY[ty]])]),
    ) as Record<AttackType, Weighted<Severity>>;
  }

  get paused(): boolean {
    return this._paused;
  }

  get activeCampaigns(): readonly { name: string; type: AttackType; source: string }[] {
    return this.campaigns.map((c) => ({ name: c.name, type: c.type, source: c.source.iso }));
  }

  subscribe(fn: (e: AttackEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      // Cap catch-up so a throttled background tab doesn't dump a flood on return.
      const dt = Math.min(250, now - this.lastTick);
      this.lastTick = now;
      if (this._paused) return;
      for (const e of this.step(dt)) for (const fn of this.listeners) fn(e);
    }, this.o.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPaused(paused: boolean): void {
    this._paused = paused;
  }

  /** Advance the simulation by dtMs and return the events produced. */
  step(dtMs: number): AttackEvent[] {
    const dt = dtMs / 1000;
    this.simTime += dt;
    const t = this.simTime;
    const rng = this.rng;
    const out: AttackEvent[] = [];

    // Expire / start campaigns.
    this.campaigns = this.campaigns.filter((c) => c.endsAt > t);
    if (
      this.campaigns.length < this.o.maxCampaigns &&
      rng() < 1 - Math.exp(-this.o.campaignRate * dt)
    ) {
      this.campaigns.push(this.newCampaign(t));
    }

    // Baseline: slowly wandering rate so the feed breathes.
    const wave =
      1 + 0.25 * Math.sin((t * 2 * Math.PI) / 90) + 0.12 * Math.sin((t * 2 * Math.PI) / 23);
    const nBase = poisson(this.o.baseRate * wave * dt, rng);
    for (let i = 0; i < nBase; i++) {
      const src = pick(this.sources, rng);
      const dst = pick(this.targetsBySource.get(src.iso)!, rng);
      const type = pick(this.mixBySource.get(src.iso)!, rng);
      out.push(this.makeEvent(src, dst, type, null, dtMs, i, nBase));
    }

    for (const c of this.campaigns) {
      const n = poisson(c.rate * dt, rng);
      for (let i = 0; i < n; i++) {
        const dst = c.target ?? pick(this.targetsBySource.get(c.source.iso)!, rng);
        out.push(this.makeEvent(c.source, dst, c.type, c, dtMs, i, n));
      }
    }
    return out;
  }

  private newCampaign(t: number): Campaign {
    const rng = this.rng;
    const source = pick(this.sources, rng);
    const type = pick(this.mixBySource.get(source.iso)!, rng);
    const a = CODENAME_A[Math.floor(rng() * CODENAME_A.length)]!;
    const b = CODENAME_B[Math.floor(rng() * CODENAME_B.length)]!;
    return {
      name: `${a} ${b}`,
      type,
      source,
      // Scans and brute force spray widely; the rest usually focus on one target.
      target:
        type === 'portscan' || (type === 'bruteforce' && rng() < 0.5)
          ? null
          : pick(this.targetsBySource.get(source.iso)!, rng),
      rate: 4 + rng() * 10,
      endsAt: t + 3 + rng() * 9,
      subnet: TEST_NETS[Math.floor(rng() * TEST_NETS.length)]!,
    };
  }

  private makeEvent(
    src: CountryInfo,
    dst: CountryInfo,
    type: AttackType,
    campaign: Campaign | null,
    dtMs: number,
    i: number,
    n: number,
  ): AttackEvent {
    const rng = this.rng;
    const sh = src.hubs[Math.floor(rng() * src.hubs.length)]!;
    const dh = dst.hubs[Math.floor(rng() * dst.hubs.length)]!;
    const jitter = () => (rng() - 0.5) * 1.6;
    let severity = pick(this.severities[type], rng);
    if (campaign && severity !== 'critical' && rng() < 0.25) {
      severity = severity === 'low' ? 'medium' : severity === 'medium' ? 'high' : 'critical';
    }
    const subnet = campaign?.subnet ?? TEST_NETS[Math.floor(rng() * TEST_NETS.length)]!;
    const ports = PORTS[type];
    const ev: AttackEvent = {
      id: `ev-${(++this.seq).toString(36)}`,
      // Spread timestamps across the tick so batches don't share one instant.
      ts: Math.round(this.o.now() - dtMs + ((i + 0.5) / n) * dtMs),
      type,
      technique: pick(this.techniques[type], rng),
      source: src.iso,
      target: dst.iso,
      srcLat: sh.lat + jitter(),
      srcLon: sh.lon + jitter(),
      dstLat: dh.lat + jitter(),
      dstLon: dh.lon + jitter(),
      srcIp: `${subnet}.${1 + Math.floor(rng() * 254)}`,
      dstPort: ports[Math.floor(rng() * ports.length)]!,
      severity,
    };
    if (campaign) ev.campaign = campaign.name;
    return ev;
  }
}
