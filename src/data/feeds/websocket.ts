/**
 * Example adapter for a real feed delivered over a WebSocket.
 *
 * Not used by default. To plug in a live source, map its messages to
 * `AttackEvent` in `normalize` and swap `new SimulatedFeed()` for
 * `new WebSocketFeed(url, normalize)` in main.ts. The same pattern works for
 * replaying an AbuseIPDB or AlienVault OTX export: parse each record, then
 * resolve countries to ISO 3166-1 numeric codes and coordinates (see
 * data/countries.ts) and classify the record into an AttackType.
 */
import type { AttackEvent, ThreatFeed } from '../types';

export type Normalizer = (raw: unknown) => AttackEvent | null;

export class WebSocketFeed implements ThreatFeed {
  readonly name = 'WebSocket feed';
  private ws: WebSocket | null = null;
  private _paused = false;
  private readonly listeners = new Set<(e: AttackEvent) => void>();
  private retry = 1000;
  private stopped = true;

  constructor(
    private readonly url: string,
    private readonly normalize: Normalizer,
  ) {}

  get paused(): boolean {
    return this._paused;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  setPaused(paused: boolean): void {
    this._paused = paused;
  }

  subscribe(fn: (e: AttackEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 1000;
    };
    ws.onmessage = (msg: MessageEvent<string>) => {
      if (this._paused) return;
      let raw: unknown;
      try {
        raw = JSON.parse(msg.data);
      } catch {
        return;
      }
      const items = Array.isArray(raw) ? (raw as unknown[]) : [raw];
      for (const item of items) {
        const e = this.normalize(item);
        if (e) for (const fn of this.listeners) fn(e);
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      // Reconnect with capped exponential backoff.
      setTimeout(() => {
        this.connect();
      }, this.retry);
      this.retry = Math.min(30_000, this.retry * 2);
    };
  }
}
