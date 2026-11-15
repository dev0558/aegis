/**
 * Parametric hand model producing MediaPipe-shaped landmarks (21 × xyz,
 * unmirrored camera space) for any finger combination, position, scale and
 * rotation. Used as deterministic fixtures for feature and gesture tests.
 */
export interface HandPose {
  /** [thumb, index, middle, ring, pinky] extended? */
  fingers: [boolean, boolean, boolean, boolean, boolean];
  /** Palm centre in view space (mirrored), fraction of frame. */
  cx?: number;
  cy?: number;
  /** Wrist → middle-MCP length in frame-height units. */
  scale?: number;
  /** In-plane rotation, radians (0 = fingers up). */
  rotation?: number;
  aspect?: number;
  /** Bring the thumb tip onto the index tip. */
  pinch?: boolean;
}

type V = [number, number, number];

const MCP: Record<string, V> = {
  index: [-0.3, -0.95, 0],
  middle: [-0.05, -1.0, 0],
  ring: [0.18, -0.95, 0],
  pinky: [0.38, -0.85, 0],
};
const SPLAY: Record<string, number> = { index: -0.12, middle: 0, ring: 0.1, pinky: 0.22 };
const LEN: Record<string, number> = { index: 1, middle: 1.08, ring: 1, pinky: 0.78 };

const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

function finger(name: string, extended: boolean): V[] {
  const base = MCP[name]!;
  const a = SPLAY[name]!;
  const up: V = [Math.sin(a), -Math.cos(a), 0];
  const L = LEN[name]!;
  if (extended) {
    const pip = add(base, up, 0.45 * L);
    const dip = add(pip, up, 0.28 * L);
    return [base, pip, dip, add(dip, up, 0.22 * L)];
  }
  // Curled: the finger folds forward and the tip returns toward the palm.
  const pip = add(add(base, up, 0.28 * L), [0, 0, -0.25], 1);
  const dip = add(pip, [0, 0.22, -0.05], L);
  const tip = add(base, [0, 0.22, -0.12], L);
  return [base, pip, dip, tip];
}

export function syntheticHand(p: HandPose): Float32Array {
  const pts: V[] = new Array<V>(21);
  pts[0] = [0, 0, 0];
  pts[1] = [-0.25, -0.2, 0];
  pts[2] = [-0.45, -0.4, 0];
  if (p.fingers[0]) {
    pts[3] = [-0.68, -0.58, 0];
    pts[4] = [-0.86, -0.74, 0];
  } else {
    pts[3] = [-0.38, -0.62, -0.05];
    pts[4] = [-0.12, -0.72, -0.08];
  }
  const names = ['index', 'middle', 'ring', 'pinky'];
  names.forEach((n, i) => {
    const f = finger(n, p.fingers[i + 1]!);
    for (let k = 0; k < 4; k++) pts[5 + i * 4 + k] = f[k]!;
  });
  if (p.pinch) {
    const tip = pts[8]!;
    pts[4] = [tip[0] + 0.03, tip[1] + 0.03, tip[2]];
    pts[3] = [(pts[2][0] + tip[0]) / 2, (pts[2][1] + tip[1]) / 2, 0];
  }

  const scale = p.scale ?? 0.18;
  const rot = p.rotation ?? 0;
  const aspect = p.aspect ?? 16 / 9;
  const cx = p.cx ?? 0.5;
  const cy = p.cy ?? 0.5;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // Palm centre in the model frame (mean of wrist + 4 MCPs).
  const palmIdx = [0, 5, 9, 13, 17];
  const pc = palmIdx.reduce<V>((acc, i) => add(acc, pts[i]!, 1 / 5), [0, 0, 0]);

  const out = new Float32Array(63);
  pts.forEach((q, i) => {
    const x = q[0] - pc[0];
    const y = q[1] - pc[1];
    const X = (x * c - y * s) * scale; // isotropic, frame-height units
    const Y = (x * s + y * c) * scale;
    const viewX = cx + X / aspect;
    const viewY = cy + Y;
    out[i * 3] = 1 - viewX; // back to unmirrored camera space
    out[i * 3 + 1] = viewY;
    out[i * 3 + 2] = (q[2] * scale) / aspect;
  });
  return out;
}

export const OPEN: HandPose['fingers'] = [true, true, true, true, true];
export const FIST: HandPose['fingers'] = [false, false, false, false, false];
export const POINT: HandPose['fingers'] = [false, true, false, false, false];
