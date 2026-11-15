/**
 * Dedicated module worker running MediaPipe HandLandmarker so inference never
 * blocks the render loop. Frames arrive as transferred ImageBitmaps and are
 * closed immediately after detection. Nothing leaves this device.
 */
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker, toRawHands } from './landmarker';
import type { FromWorker, ToWorker } from './trackerProtocol';

interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  close(): void;
}
const scope = self as unknown as WorkerScope;

let landmarker: HandLandmarker | null = null;

const post = (m: FromWorker, transfer: Transferable[] = []) => {
  scope.postMessage(m, transfer);
};

scope.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      createLandmarker({
        wasmBase: msg.wasmBase,
        modelUrl: msg.modelUrl,
        delegate: msg.delegate,
        numHands: msg.numHands,
        useModule: true,
        // GPU delegate needs a WebGL context; workers have no DOM canvas.
        ...(msg.delegate === 'GPU' ? { canvas: new OffscreenCanvas(1, 1) } : {}),
      }).then(
        (lm) => {
          landmarker = lm;
          post({ type: 'ready', delegate: msg.delegate });
        },
        (err: unknown) => {
          post({ type: 'error', stage: 'init', message: String(err) });
        },
      );
      break;
    case 'detect': {
      const frame = msg.frame;
      try {
        if (!landmarker) throw new Error('Landmarker not ready');
        const t0 = performance.now();
        const hands = toRawHands(landmarker.detectForVideo(frame, msg.t));
        post(
          { type: 'result', t: msg.t, hands, inferMs: performance.now() - t0 },
          hands.map((h) => h.landmarks.buffer),
        );
      } catch (err) {
        post({ type: 'error', stage: 'detect', message: String(err) });
      } finally {
        frame.close();
      }
      break;
    }
    case 'close':
      landmarker?.close();
      landmarker = null;
      scope.close();
      break;
  }
};
