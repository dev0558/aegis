import * as THREE from 'three';
import { latLonToVec3, vec3ToLatLon } from '../data/geo';
import { mulberry32 } from '../util/prng';
import type { CountryMap } from './countryMap';
import vert from './shaders/particles.vert.glsl?raw';
import frag from './shaders/particles.frag.glsl?raw';

export interface ParticleOptions {
  /** Approximate total particle count. */
  count: number;
  /** Share of particles that sit on land (land is ~29% of the sphere). */
  landShare: number;
  seed: number;
}

const DEFAULTS: ParticleOptions = { count: 20000, landShare: 0.62, seed: 7 };

/**
 * Particle Earth. Land particles are laid out on an even Fibonacci lattice
 * (crisp coastlines); ocean particles are a sparse random subset.
 * Each particle carries its country index so highlighting is a uniform change.
 */
export class ParticleEarth {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  readonly count: number;

  constructor(map: CountryMap, opts: Partial<ParticleOptions> = {}) {
    const o = { ...DEFAULTS, ...opts };
    const rng = mulberry32(o.seed);
    const landTarget = Math.round(o.count * o.landShare);
    const oceanTarget = o.count - landTarget;

    // Size the lattice so its land points ≈ landTarget (~29% of points fall on land).
    const m = Math.round(landTarget / 0.29);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const jitter = 0.35 * Math.sqrt((4 * Math.PI) / m);
    const land: number[] = [];
    const ocean: number[] = [];
    for (let i = 0; i < m; i++) {
      const y = 1 - ((i + 0.5) / m) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      let x = Math.cos(th) * r + (rng() - 0.5) * jitter;
      let yy = y + (rng() - 0.5) * jitter;
      let z = Math.sin(th) * r + (rng() - 0.5) * jitter;
      const len = Math.hypot(x, yy, z);
      x /= len;
      yy /= len;
      z /= len;
      const { lat, lon } = vec3ToLatLon(x, yy, z);
      const idx = map.indexAt(lat, lon);
      (idx ? land : ocean).push(lat, lon, idx);
    }
    // Random subset of ocean candidates, with slight radial lift variation.
    const oceanCount = Math.min(oceanTarget, ocean.length / 3);
    const pickP = oceanCount / (ocean.length / 3);
    const chosen: number[] = [];
    for (let i = 0; i < ocean.length; i += 3) {
      if (rng() < pickP) chosen.push(ocean[i]!, ocean[i + 1]!, 0);
    }

    const all = land.concat(chosen);
    const n = all.length / 3;
    this.count = n;
    const pos = new Float32Array(n * 3);
    const country = new Float32Array(n);
    const rand = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const lat = all[i * 3]!;
      const lon = all[i * 3 + 1]!;
      const idx = all[i * 3 + 2]!;
      const r = idx ? 1 : 0.995;
      const v = latLonToVec3(lat, lon, r);
      pos.set(v, i * 3);
      country[i] = idx;
      rand[i * 4] = rng();
      rand[i * 4 + 1] = rng();
      rand[i * 4 + 2] = rng();
      rand[i * 4 + 3] = rng();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCountry', new THREE.BufferAttribute(country, 1));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 0.015 },
        uScale: { value: 800 },
        uHover: { value: 0 },
        uSelected: { value: 0 },
        uBurstAge: { value: -1 },
        uBurstStrength: { value: 0 },
        uCharge: { value: 0 },
        uMotion: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  private u(name: string): THREE.IUniform {
    return this.material.uniforms[name]!;
  }

  setTime(t: number): void {
    this.u('uTime').value = t;
  }
  setScale(pxScale: number): void {
    this.u('uScale').value = pxScale;
  }
  setHover(index: number): void {
    this.u('uHover').value = index;
  }
  setSelected(index: number): void {
    this.u('uSelected').value = index;
  }
  setCharge(c: number): void {
    this.u('uCharge').value = c;
  }
  setMotion(full: boolean): void {
    this.u('uMotion').value = full ? 1 : 0;
  }
  /** Seconds since a burst started (negative = none). */
  setBurst(age: number, strength: number): void {
    this.u('uBurstAge').value = age;
    this.u('uBurstStrength').value = strength;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
