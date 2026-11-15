import * as THREE from 'three';
import { mulberry32 } from '../util/prng';
import vert from './shaders/stars.vert.glsl?raw';
import frag from './shaders/stars.frag.glsl?raw';

export interface Stars {
  points: THREE.Points;
  update(t: number, pixelRatio: number): void;
  setMotion(full: boolean): void;
}

/** A sparse, faint starfield on a distant shell for depth. */
export function createStars(count = 900): Stars {
  const rng = mulberry32(99);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const r = 40 + rng() * 20;
    const q = Math.sqrt(1 - u * u);
    pos.set([q * Math.cos(th) * r, u * r, q * Math.sin(th) * r], i * 3);
    seed[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uMotion: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  const u = mat.uniforms as Record<'uTime' | 'uPixelRatio' | 'uMotion', THREE.IUniform<number>>;
  return {
    points: pts,
    update(t, pixelRatio) {
      u.uTime.value = t;
      u.uPixelRatio.value = pixelRatio;
    },
    setMotion(full) {
      u.uMotion.value = full ? 1 : 0;
    },
  };
}
