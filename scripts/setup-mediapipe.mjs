// Self-hosts the MediaPipe runtime so the app makes no third-party requests:
//  - copies the tasks-vision wasm loader + binaries from node_modules
//  - downloads the hand landmarker model once (cached in public/mediapipe)
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'mediapipe');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const modelPath = join(out, 'hand_landmarker.task');

await mkdir(join(out, 'wasm'), { recursive: true });
for (const f of [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
]) {
  await copyFile(join(wasmSrc, f), join(out, 'wasm', f));
}

const exists = await stat(modelPath).then(
  (s) => s.size > 1_000_000,
  () => false,
);
if (!exists) {
  process.stdout.write('Downloading hand landmarker model… ');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
  await writeFile(modelPath, new Uint8Array(await res.arrayBuffer()));
  console.log('done');
}
console.log('MediaPipe assets ready in public/mediapipe');
