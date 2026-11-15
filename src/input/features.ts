/**
 * Pure landmark → feature extraction. No state, no DOM: unit-testable with
 * recorded or synthetic landmark fixtures.
 *
 * Input landmarks are MediaPipe's: a flat array of 21 × (x, y, z) in the
 * *unmirrored* camera image, x/y normalized to [0,1], z ≈ same scale as x.
 * Output positions are in "view space": mirrored (selfie view), fractions of
 * the frame. Distances use isotropic units (fractions of frame height) so
 * they are aspect-ratio independent.
 */

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
} as const;

export const NUM_LANDMARKS = 21;

export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]; // prettier-ignore

export interface Pt {
  x: number;
  y: number;
}

export type Fingers = readonly [number, number, number, number, number];

export interface HandFeatures {
  /** Palm centre (mean of wrist + 4 MCPs), view space. */
  palm: Pt;
  indexTip: Pt;
  /** Midpoint of thumb and index tips, view space. */
  pinchPoint: Pt;
  /** Wrist → middle MCP length, isotropic units. */
  handScale: number;
  /**
   * Per-finger extension score [thumb, index, middle, ring, pinky].
   * ≥ 1 means clearly extended, ≤ ~0.5 clearly curled.
   */
  ext: Fingers;
  /** Thumb-tip ↔ index-tip distance / handScale (small = pinching). */
  pinch: number;
}

/** Landmark i in isotropic 3D (units: frame height), mirrored. */
function iso(lm: ArrayLike<number>, i: number, aspect: number): [number, number, number] {
  return [(1 - lm[i * 3]!) * aspect, lm[i * 3 + 1]!, lm[i * 3 + 2]! * aspect];
}

function dist3(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function view(lm: ArrayLike<number>, i: number): Pt {
  return { x: 1 - lm[i * 3]!, y: lm[i * 3 + 1]! };
}

const FINGERS: readonly (readonly [tip: number, pip: number])[] = [
  [LM.INDEX_TIP, LM.INDEX_PIP],
  [LM.MIDDLE_TIP, LM.MIDDLE_PIP],
  [LM.RING_TIP, LM.RING_PIP],
  [LM.PINKY_TIP, LM.PINKY_PIP],
];

/**
 * @param lm     flat landmarks (63 numbers), unmirrored camera space
 * @param aspect camera frame width / height
 */
export function extractFeatures(lm: ArrayLike<number>, aspect: number): HandFeatures {
  const P = (i: number) => iso(lm, i, aspect);
  const wrist = P(LM.WRIST);
  const handScale = Math.max(1e-4, dist3(wrist, P(LM.MIDDLE_MCP)));

  // Fingers: a straight finger's tip is well beyond its PIP joint from the wrist.
  const ext: number[] = [0];
  for (const [tip, pip] of FINGERS) {
    const ratio = dist3(wrist, P(tip)) / Math.max(1e-4, dist3(wrist, P(pip)));
    ext.push((ratio - 1) / 0.2);
  }

  // Thumb: extended when its tip is far from the index knuckle and it points
  // away from the palm (tip farther from the pinky knuckle than the IP joint).
  const thumbTip = P(LM.THUMB_TIP);
  const spread = dist3(thumbTip, P(LM.INDEX_MCP)) / handScale;
  const pinkyMcp = P(LM.PINKY_MCP);
  const outward = dist3(thumbTip, pinkyMcp) > dist3(P(LM.THUMB_IP), pinkyMcp);
  ext[0] = outward ? spread / 0.5 : Math.min(spread / 0.5, 0.5);

  let px = 0;
  let py = 0;
  for (const i of [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP]) {
    px += 1 - lm[i * 3]!;
    py += lm[i * 3 + 1]!;
  }
  const t = view(lm, LM.THUMB_TIP);
  const ix = view(lm, LM.INDEX_TIP);

  return {
    palm: { x: px / 5, y: py / 5 },
    indexTip: ix,
    pinchPoint: { x: (t.x + ix.x) / 2, y: (t.y + ix.y) / 2 },
    handScale,
    ext: ext as unknown as Fingers,
    pinch: dist3(thumbTip, P(LM.INDEX_TIP)) / handScale,
  };
}

/** Isotropic distance between two view-space points. */
export function viewDistance(a: Pt, b: Pt, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/**
 * Map a view-space point to screen CSS pixels, matching a mirrored
 * `object-fit: cover` video of size vw×vh on a sw×sh viewport.
 */
export function viewToScreen(p: Pt, vw: number, vh: number, sw: number, sh: number): Pt {
  const s = Math.max(sw / vw, sh / vh);
  const dw = vw * s;
  const dh = vh * s;
  return { x: (sw - dw) / 2 + p.x * dw, y: (sh - dh) / 2 + p.y * dh };
}
