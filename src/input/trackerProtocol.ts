/** Messages between the main thread and the hand-tracking worker. */

export type Delegate = 'GPU' | 'CPU';

export interface RawHand {
  /** 21 × (x, y, z), MediaPipe normalized image coordinates (unmirrored). */
  landmarks: Float32Array;
  handedness: string;
  score: number;
}

export type ToWorker =
  | { type: 'init'; wasmBase: string; modelUrl: string; delegate: Delegate; numHands: number }
  | { type: 'detect'; frame: ImageBitmap; t: number }
  | { type: 'close' };

export type FromWorker =
  | { type: 'ready'; delegate: Delegate }
  | { type: 'error'; stage: 'init' | 'detect'; message: string }
  | { type: 'result'; t: number; hands: RawHand[]; inferMs: number };
