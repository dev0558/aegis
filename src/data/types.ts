/**
 * Core data model. Any threat source (the built-in simulator, a WebSocket, an
 * AbuseIPDB / OTX export…) is adapted into `AttackEvent`s behind `ThreatFeed`.
 */

export const ATTACK_TYPES = ['ddos', 'bruteforce', 'c2', 'phishing', 'portscan'] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];

export interface AttackTypeInfo {
  id: AttackType;
  label: string;
  short: string;
  /** Display colour, hex. */
  color: string;
}

export const ATTACK_TYPE_INFO: Record<AttackType, AttackTypeInfo> = {
  ddos: { id: 'ddos', label: 'DDoS', short: 'DDoS', color: '#ff5c7a' },
  bruteforce: { id: 'bruteforce', label: 'Brute force', short: 'Brute', color: '#ffb347' },
  c2: { id: 'c2', label: 'Malware C2', short: 'C2', color: '#b18cff' },
  phishing: { id: 'phishing', label: 'Phishing', short: 'Phish', color: '#4fe0b6' },
  portscan: { id: 'portscan', label: 'Port scan', short: 'Scan', color: '#5cc8ff' },
};

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Technique {
  /** MITRE ATT&CK technique ID, e.g. "T1110.003". */
  id: string;
  name: string;
}

/** ISO 3166-1 numeric code, zero-padded to 3 digits (matches world-atlas ids). */
export type CountryCode = string;

export interface AttackEvent {
  id: string;
  /** Epoch milliseconds. */
  ts: number;
  type: AttackType;
  technique: Technique;
  source: CountryCode;
  target: CountryCode;
  /** Source coordinates (a hub inside the country, jittered). */
  srcLat: number;
  srcLon: number;
  dstLat: number;
  dstLon: number;
  srcIp: string;
  dstPort: number;
  severity: Severity;
  /** Set when the event belongs to a coordinated burst. */
  campaign?: string;
}

export interface ThreatFeed {
  readonly name: string;
  readonly paused: boolean;
  start(): void;
  stop(): void;
  setPaused(paused: boolean): void;
  /** Returns an unsubscribe function. */
  subscribe(fn: (e: AttackEvent) => void): () => void;
}
