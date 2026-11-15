/**
 * Shared HandLandmarker construction + result conversion, used both by the
 * Web Worker backend and by the main-thread fallback.
 */
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { Delegate, RawHand } from './trackerProtocol';

export async function createLandmarker(opts: {
  wasmBase: string;
  modelUrl: string;
  delegate: Delegate;
  numHands: number;
  /** ES-module wasm loader (required inside module workers). */
  useModule: boolean;
  canvas?: HTMLCanvasElement | OffscreenCanvas;
}): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(opts.wasmBase, opts.useModule);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: opts.modelUrl, delegate: opts.delegate },
    runningMode: 'VIDEO',
    numHands: opts.numHands,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    ...(opts.canvas ? { canvas: opts.canvas } : {}),
  });
}

export function toRawHands(r: HandLandmarkerResult): RawHand[] {
  return r.landmarks.map((lms, i) => {
    const flat = new Float32Array(lms.length * 3);
    lms.forEach((p, j) => {
      flat[j * 3] = p.x;
      flat[j * 3 + 1] = p.y;
      flat[j * 3 + 2] = p.z;
    });
    const cat = r.handedness[i]?.[0];
    return { landmarks: flat, handedness: cat?.categoryName ?? '', score: cat?.score ?? 0 };
  });
}
