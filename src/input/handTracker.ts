/**
 * Camera + hand landmark detection, kept off the render loop's critical path.
 *
 * Backends, tried in order: Worker/GPU → Worker/CPU → main thread/GPU →
 * main thread/CPU. Frames are scheduled with requestVideoFrameCallback, one
 * in flight at a time, at an adaptive rate that drops when render frames run
 * long and recovers when they are healthy.
 *
 * The camera stream is only ever read locally; no frame is sent anywhere.
 */
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type { Delegate, FromWorker, RawHand, ToWorker } from './trackerProtocol';

export type TrackerErrorKind =
  'insecure' | 'unsupported' | 'denied' | 'notfound' | 'inuse' | 'model' | 'unknown';

export class TrackerError extends Error {
  constructor(
    readonly kind: TrackerErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'TrackerError';
  }
}

export interface TrackerFrame {
  /** performance.now() at capture, ms. */
  t: number;
  hands: RawHand[];
  videoWidth: number;
  videoHeight: number;
}

export type Backend = 'worker-gpu' | 'worker-cpu' | 'main-gpu' | 'main-cpu';

const BASE = import.meta.env.BASE_URL;
const WASM_BASE = new URL(`${BASE}mediapipe/wasm`, location.href).href;
const MODEL_URL = new URL(`${BASE}mediapipe/hand_landmarker.task`, location.href).href;
const INIT_TIMEOUT_MS = 90_000; // first load downloads ~22 MB of wasm + model
const MAX_HZ = 30;
const MIN_HZ = 10;
const DETECT_WIDTH = 640;

interface DetectorBackend {
  readonly kind: Backend;
  /** Resolves with hands, or null when the frame was dropped. */
  detect(video: HTMLVideoElement, t: number): Promise<{ hands: RawHand[]; inferMs: number }>;
  close(): void;
}

export class HandTracker {
  onFrame: (f: TrackerFrame) => void = () => undefined;
  targetHz = MAX_HZ;
  inferMs = 0;
  backend: Backend | null = null;

  private stream: MediaStream | null = null;
  private detector: DetectorBackend | null = null;
  private running = false;
  private inFlight = false;
  private lastSent = 0;
  private loadEma = 16.7;
  private slowFor = 0;
  private fastFor = 0;

  constructor(readonly video: HTMLVideoElement) {}

  get active(): boolean {
    return this.running;
  }

  async start(onStage: (stage: 'camera' | 'model') => void = () => undefined): Promise<void> {
    if (this.running) return;
    if (!window.isSecureContext) {
      throw new TrackerError('insecure', 'The camera needs a secure (https or localhost) page.');
    }
    if (!(navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia) {
      throw new TrackerError('unsupported', 'This browser does not support camera access.');
    }

    onStage('camera');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
    } catch (e) {
      throw mapMediaError(e);
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => undefined);
    if (this.video.readyState < 2) {
      await new Promise<void>((r) => {
        this.video.addEventListener(
          'loadeddata',
          () => {
            r();
          },
          { once: true },
        );
      });
    }

    onStage('model');
    try {
      this.detector = await createBestDetector();
    } catch (e) {
      this.stopStream();
      throw new TrackerError(
        'model',
        `The hand-tracking model failed to load. ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    this.backend = this.detector.kind;
    if (this.backend.startsWith('main')) this.targetHz = 20;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.detector?.close();
    this.detector = null;
    this.backend = null;
    this.stopStream();
  }

  /** Feed render frame times; lowers detection rate when the render loop struggles. */
  reportRenderFrame(frameMs: number, dt: number): void {
    this.loadEma += (frameMs - this.loadEma) * 0.1;
    if (this.loadEma > 19.5) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.loadEma < 17.8) {
      this.fastFor += dt;
      this.slowFor = 0;
    }
    if (this.slowFor > 1 && this.targetHz > MIN_HZ) {
      this.targetHz = Math.max(MIN_HZ, this.targetHz - 5);
      this.slowFor = 0;
    } else if (this.fastFor > 3 && this.targetHz < MAX_HZ) {
      this.targetHz = Math.min(MAX_HZ, this.targetHz + 5);
      this.fastFor = 0;
    }
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((tr) => {
      tr.stop();
    });
    this.stream = null;
    this.video.srcObject = null;
  }

  private schedule(): void {
    if (!this.running) return;
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype)
      this.video.requestVideoFrameCallback(() => void this.tick());
    else setTimeout(() => void this.tick(), 1000 / MAX_HZ);
  }

  private async tick(): Promise<void> {
    if (!this.running || !this.detector) return;
    const now = performance.now();
    if (this.inFlight || document.hidden || now - this.lastSent < 1000 / this.targetHz - 2) {
      this.schedule();
      return;
    }
    this.inFlight = true;
    this.lastSent = now;
    this.schedule();
    try {
      const r = await this.detector.detect(this.video, now);
      this.inferMs += (r.inferMs - this.inferMs) * 0.2;
      // The tracker may have been stopped while this frame was in flight.
      if (this.active) {
        this.onFrame({
          t: now,
          hands: r.hands,
          videoWidth: this.video.videoWidth,
          videoHeight: this.video.videoHeight,
        });
      }
    } catch (e) {
      console.warn('[aegis] hand detection failed for a frame', e);
    } finally {
      this.inFlight = false;
    }
  }
}

function mapMediaError(e: unknown): TrackerError {
  const name = e instanceof DOMException ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new TrackerError('denied', 'Camera permission was denied.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new TrackerError('notfound', 'No camera was found on this device.');
    case 'NotReadableError':
    case 'AbortError':
      return new TrackerError('inuse', 'The camera is in use by another application.');
    default:
      return new TrackerError('unknown', e instanceof Error ? e.message : String(e));
  }
}

// ---- backends ----------------------------------------------------------------

async function createBestDetector(): Promise<DetectorBackend> {
  const errors: string[] = [];
  const attempts: (() => Promise<DetectorBackend>)[] = [
    () => createWorkerDetector('GPU'),
    () => createWorkerDetector('CPU'),
    () => createMainDetector('GPU'),
    () => createMainDetector('CPU'),
  ];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(errors.join(' · '));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`${what} timed out`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function createWorkerDetector(delegate: Delegate): Promise<DetectorBackend> {
  if (typeof OffscreenCanvas === 'undefined' && delegate === 'GPU') {
    throw new Error('OffscreenCanvas unavailable');
  }
  const worker = new Worker(new URL('./handWorker.ts', import.meta.url), { type: 'module' });
  const send = (m: ToWorker, transfer: Transferable[] = []) => {
    worker.postMessage(m, transfer);
  };
  const pending = new Map<
    number,
    { resolve: (r: { hands: RawHand[]; inferMs: number }) => void; reject: (e: Error) => void }
  >();

  const ready = new Promise<void>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'ready') resolve();
      else if (m.type === 'error' && m.stage === 'init') reject(new Error(m.message));
      else if (m.type === 'result') {
        pending.get(m.t)?.resolve({ hands: m.hands, inferMs: m.inferMs });
        pending.delete(m.t);
      } else {
        // A detect error: fail every in-flight request (there is at most one).
        for (const p of pending.values()) p.reject(new Error(m.message));
        pending.clear();
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || 'Worker failed to start'));
    };
  });
  send({ type: 'init', wasmBase: WASM_BASE, modelUrl: MODEL_URL, delegate, numHands: 2 });
  try {
    await withTimeout(ready, INIT_TIMEOUT_MS, `Worker ${delegate} init`);
  } catch (e) {
    worker.terminate();
    throw e;
  }

  return {
    kind: delegate === 'GPU' ? 'worker-gpu' : 'worker-cpu',
    async detect(video, t) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const w = Math.min(DETECT_WIDTH, vw);
      const frame = await createImageBitmap(video, {
        resizeWidth: w,
        resizeHeight: Math.round((w * vh) / vw),
        resizeQuality: 'low',
      });
      return new Promise((resolve, reject) => {
        pending.set(t, { resolve, reject });
        send({ type: 'detect', frame, t }, [frame]);
      });
    },
    close() {
      send({ type: 'close' });
      setTimeout(() => {
        worker.terminate();
      }, 500);
    },
  };
}

async function createMainDetector(delegate: Delegate): Promise<DetectorBackend> {
  const { createLandmarker, toRawHands } = await import('./landmarker');
  const lm: HandLandmarker = await withTimeout(
    createLandmarker({
      wasmBase: WASM_BASE,
      modelUrl: MODEL_URL,
      delegate,
      numHands: 2,
      useModule: false,
      ...(delegate === 'GPU' ? { canvas: document.createElement('canvas') } : {}),
    }),
    INIT_TIMEOUT_MS,
    `Main-thread ${delegate} init`,
  );
  return {
    kind: delegate === 'GPU' ? 'main-gpu' : 'main-cpu',
    detect(video, t) {
      const t0 = performance.now();
      const hands = toRawHands(lm.detectForVideo(video, t));
      return Promise.resolve({ hands, inferMs: performance.now() - t0 });
    },
    close() {
      lm.close();
    },
  };
}
