import * as THREE from 'three';
import { angularDistance, latLonToVec3 } from '../data/geo';
import { ATTACK_TYPE_INFO, ATTACK_TYPES, type AttackEvent, type AttackType } from '../data/types';
import arcVert from './shaders/arc.vert.glsl?raw';
import arcFrag from './shaders/arc.frag.glsl?raw';
import impactVert from './shaders/impact.vert.glsl?raw';
import impactFrag from './shaders/impact.frag.glsl?raw';

const MAX_ARCS = 640;
const MAX_IMPACTS = 1024;
const SEGMENTS = 40;
const TRAIL = 0.42;

const SEVERITY_LEVEL = { low: 0, medium: 0.35, high: 0.7, critical: 1 } as const;
const TYPE_INDEX = Object.fromEntries(ATTACK_TYPES.map((t, i) => [t, i])) as Record<
  AttackType,
  number
>;
/** Arc colours, pre-brightened a little for the additive/bloom pipeline. */
const TYPE_COLOR = Object.fromEntries(
  ATTACK_TYPES.map((t) => [t, new THREE.Color(ATTACK_TYPE_INFO[t].color)]),
) as Record<AttackType, THREE.Color>;

function attr(geo: THREE.InstancedBufferGeometry, name: string, size: number, count: number) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}

/**
 * Pooled, instanced attack arcs plus launch/impact rings. Spawning writes a
 * few instance attributes into a ring buffer; all animation happens on the GPU.
 */
export class AttackArcs {
  readonly group = new THREE.Group();
  private readonly arcMat: THREE.ShaderMaterial;
  private readonly impMat: THREE.ShaderMaterial;
  private readonly a: Record<
    'start' | 'end' | 'color' | 'timing' | 'meta',
    THREE.InstancedBufferAttribute
  >;
  private readonly i: Record<'pos' | 'color' | 'timing' | 'meta', THREE.InstancedBufferAttribute>;
  private nextArc = 0;
  private nextImpact = 0;
  private dirtyArcs = false;
  private dirtyImpacts = false;
  /** End times of arcs, for counting active ones on the CPU. */
  private readonly arcEnds = new Float32Array(MAX_ARCS);
  private readonly typeMask = [1, 1, 1, 1, 1];

  constructor() {
    // ---- arcs: a triangle strip of SEGMENTS quads, instanced ----
    const g = new THREE.InstancedBufferGeometry();
    const n = SEGMENTS + 1;
    const aT = new Float32Array(n * 2);
    const aSide = new Float32Array(n * 2);
    const pos = new Float32Array(n * 2 * 3);
    for (let k = 0; k < n; k++) {
      aT[k * 2] = aT[k * 2 + 1] = k / SEGMENTS;
      aSide[k * 2] = -1;
      aSide[k * 2 + 1] = 1;
    }
    const index: number[] = [];
    for (let k = 0; k < SEGMENTS; k++) {
      const a0 = k * 2;
      index.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
    g.setIndex(index);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    this.a = {
      start: attr(g, 'aStart', 3, MAX_ARCS),
      end: attr(g, 'aEnd', 3, MAX_ARCS),
      color: attr(g, 'aColor', 3, MAX_ARCS),
      timing: attr(g, 'aTiming', 4, MAX_ARCS),
      meta: attr(g, 'aMeta', 4, MAX_ARCS),
    };
    // Every slot starts long dead.
    for (let k = 0; k < MAX_ARCS; k++) this.a.timing.setXYZW(k, -1e6, 1, 0, 0);
    g.instanceCount = MAX_ARCS;

    this.arcMat = new THREE.ShaderMaterial({
      vertexShader: arcVert,
      fragmentShader: arcFrag,
      uniforms: {
        uTime: { value: 0 },
        uTrail: { value: TRAIL },
        uSelected: { value: 0 },
        uMotion: { value: 1 },
        uTypeMask: { value: this.typeMask },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arcs = new THREE.Mesh(g, this.arcMat);
    arcs.frustumCulled = false;
    arcs.renderOrder = 2;

    // ---- impact / launch rings ----
    const ig = new THREE.InstancedBufferGeometry();
    ig.copy(new THREE.PlaneGeometry(2, 2) as unknown as THREE.InstancedBufferGeometry);
    this.i = {
      pos: attr(ig, 'aPos', 3, MAX_IMPACTS),
      color: attr(ig, 'aColor', 3, MAX_IMPACTS),
      timing: attr(ig, 'aTiming', 4, MAX_IMPACTS),
      meta: attr(ig, 'aMeta', 2, MAX_IMPACTS),
    };
    for (let k = 0; k < MAX_IMPACTS; k++) this.i.timing.setXYZW(k, -1e6, 1, 0, 0);
    ig.instanceCount = MAX_IMPACTS;
    this.impMat = new THREE.ShaderMaterial({
      vertexShader: impactVert,
      fragmentShader: impactFrag,
      uniforms: {
        uTime: { value: 0 },
        uSelected: { value: 0 },
        uTypeMask: { value: this.typeMask },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const rings = new THREE.Mesh(ig, this.impMat);
    rings.frustumCulled = false;
    rings.renderOrder = 1;

    this.group.add(rings, arcs);
  }

  spawn(e: AttackEvent, now: number, srcIndex: number, dstIndex: number): void {
    const s = latLonToVec3(e.srcLat, e.srcLon);
    const d = latLonToVec3(e.dstLat, e.dstLon);
    const ang = angularDistance({ lat: e.srcLat, lon: e.srcLon }, { lat: e.dstLat, lon: e.dstLon });
    const k = ang / Math.PI;
    const travel = 0.9 + 1.5 * k + Math.random() * 0.25;
    const height = 0.03 + 0.42 * k;
    const sev = SEVERITY_LEVEL[e.severity];
    const width = 0.0045 + 0.0035 * sev;
    const c = TYPE_COLOR[e.type];
    const ti = TYPE_INDEX[e.type];

    const j = this.nextArc;
    this.nextArc = (j + 1) % MAX_ARCS;
    this.a.start.setXYZ(j, s[0], s[1], s[2]);
    this.a.end.setXYZ(j, d[0], d[1], d[2]);
    this.a.color.setXYZ(j, c.r, c.g, c.b);
    this.a.timing.setXYZW(j, now, travel, height, width);
    this.a.meta.setXYZW(j, srcIndex, dstIndex, ti, sev);
    this.arcEnds[j] = now + travel * (1 + TRAIL);
    this.dirtyArcs = true;

    // Small launch pulse at the source now, larger impact at the target on arrival.
    this.ring(s, c, now, 0.9, 0.025, srcIndex, ti);
    this.ring(d, c, now + travel, 1.4, 0.05 + 0.04 * sev, dstIndex, ti);
  }

  private ring(
    p: readonly number[],
    c: THREE.Color,
    start: number,
    life: number,
    size: number,
    country: number,
    type: number,
  ): void {
    const j = this.nextImpact;
    this.nextImpact = (j + 1) % MAX_IMPACTS;
    this.i.pos.setXYZ(j, p[0]!, p[1]!, p[2]!);
    this.i.color.setXYZ(j, c.r, c.g, c.b);
    this.i.timing.setXYZW(j, start, life, size, 1);
    this.i.meta.setXY(j, country, type);
    this.dirtyImpacts = true;
  }

  /** Remove every arc and ring immediately (purge). */
  clear(): void {
    for (let k = 0; k < MAX_ARCS; k++) {
      this.a.timing.setX(k, -1e6);
      this.arcEnds[k] = 0;
    }
    for (let k = 0; k < MAX_IMPACTS; k++) this.i.timing.setX(k, -1e6);
    this.dirtyArcs = this.dirtyImpacts = true;
  }

  activeCount(now: number): number {
    let n = 0;
    for (let k = 0; k < MAX_ARCS; k++) if (this.arcEnds[k]! > now) n++;
    return n;
  }

  setTypeMask(visible: readonly boolean[]): void {
    visible.forEach((v, k) => (this.typeMask[k] = v ? 1 : 0));
  }

  setSelected(index: number): void {
    this.arcMat.uniforms['uSelected']!.value = index;
    this.impMat.uniforms['uSelected']!.value = index;
  }

  setMotion(full: boolean): void {
    this.arcMat.uniforms['uMotion']!.value = full ? 1 : 0;
  }

  update(now: number): void {
    this.arcMat.uniforms['uTime']!.value = now;
    this.impMat.uniforms['uTime']!.value = now;
    if (this.dirtyArcs) {
      for (const a of Object.values(this.a)) a.needsUpdate = true;
      this.dirtyArcs = false;
    }
    if (this.dirtyImpacts) {
      for (const a of Object.values(this.i)) a.needsUpdate = true;
      this.dirtyImpacts = false;
    }
  }
}
