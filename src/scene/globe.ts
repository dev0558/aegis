import * as THREE from 'three';
import { vec3ToLatLon, type LatLon } from '../data/geo';
import { clamp, damp } from '../util/math';
import { debugFlag } from '../util/debug';
import type { CountryMap } from './countryMap';
import { ParticleEarth } from './particles';
import atmoVert from './shaders/atmosphere.vert.glsl?raw';
import atmoFrag from './shaders/atmosphere.frag.glsl?raw';

export const BASE_DISTANCE = 4.3;
export const MIN_ZOOM = 0.65;
export const MAX_ZOOM = 2.8;
const PITCH_LIMIT = 1.15;
const INERTIA_DECAY = 1.4; // 1/s
const AUTO_YAW = 0.07; // rad/s
const AUTO_DELAY = 2.5; // s of no input before auto-rotation resumes

export interface PickResult {
  country: number;
  latLon: LatLon;
}

/**
 * The globe group plus its rotation/zoom rig.
 * Orientation = Rx(pitch) · Ry(yaw), so yaw spins about the poles and pitch
 * tilts toward the viewer; north always stays roughly up.
 */
export class Globe {
  readonly group = new THREE.Group();
  readonly earth: ParticleEarth;
  /** Invisible depth-only sphere so arcs behind the planet are hidden. */
  readonly occluder: THREE.Mesh;

  yaw = -0.3;
  pitch = 0.32;
  private yawVel = 0;
  private pitchVel = 0;
  /** Velocity requested by a held input (hand / arrow keys); null = free. */
  private heldVel: { yaw: number; pitch: number } | null = null;
  private dragging = false;
  private dragAccum = { yaw: 0, pitch: 0 };
  private idleTime = 0;
  zoom = 1;
  private targetZoom = 1;
  autoRotate = true;

  private readonly ray = new THREE.Raycaster();
  private readonly inv = new THREE.Matrix4();
  private readonly tmpO = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();

  constructor(map: CountryMap) {
    this.earth = new ParticleEarth(map);
    this.group.add(this.earth.points);

    this.occluder = new THREE.Mesh(
      new THREE.SphereGeometry(0.985, 48, 32),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    );
    this.occluder.renderOrder = -1;
    this.group.add(this.occluder);

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.14, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: atmoVert,
        fragmentShader: atmoFrag,
        uniforms: {
          uColor: { value: new THREE.Color(0.35, 0.55, 1.0) },
          uIntensity: { value: 0.75 },
        },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    if (!debugFlag('noatmo')) this.group.add(atmo);
  }

  // ---- input -------------------------------------------------------------

  rotateBy(dYaw: number, dPitch: number): void {
    this.dragging = true;
    this.heldVel = null;
    this.dragAccum.yaw += dYaw;
    this.dragAccum.pitch += dPitch;
    this.idleTime = 0;
  }

  setRotateVelocity(yaw: number, pitch: number): void {
    this.dragging = false;
    this.heldVel = { yaw, pitch };
    this.idleTime = 0;
  }

  release(): void {
    this.dragging = false;
    this.heldVel = null;
  }

  zoomBy(factor: number): void {
    this.targetZoom = clamp(this.targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.idleTime = 0;
  }

  zoomTo(z: number): void {
    this.targetZoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.idleTime = 0;
  }

  resetView(): void {
    this.targetZoom = 1;
    this.heldVel = null;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.pitch = 0.32;
  }

  get cameraDistance(): number {
    return BASE_DISTANCE / this.zoom;
  }

  // ---- simulation --------------------------------------------------------

  update(dt: number): void {
    this.idleTime += dt;
    if (this.dragging) {
      // Apply the drag directly; remember its velocity for inertia on release.
      const a = damp(20, dt);
      this.yawVel += (this.dragAccum.yaw / dt - this.yawVel) * a;
      this.pitchVel += (this.dragAccum.pitch / dt - this.pitchVel) * a;
      this.yaw += this.dragAccum.yaw;
      this.pitch += this.dragAccum.pitch;
      this.dragAccum.yaw = 0;
      this.dragAccum.pitch = 0;
    } else {
      if (this.heldVel) {
        const a = damp(10, dt);
        this.yawVel += (this.heldVel.yaw - this.yawVel) * a;
        this.pitchVel += (this.heldVel.pitch - this.pitchVel) * a;
      } else {
        const decay = Math.exp(-INERTIA_DECAY * dt);
        const auto = this.autoRotate && this.idleTime > AUTO_DELAY ? AUTO_YAW : 0;
        // Decay toward the auto-rotation speed (or zero).
        this.yawVel = auto + (this.yawVel - auto) * decay;
        this.pitchVel *= decay;
      }
      this.yaw += this.yawVel * dt;
      this.pitch += this.pitchVel * dt;
    }
    if (this.pitch > PITCH_LIMIT || this.pitch < -PITCH_LIMIT) {
      this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
      this.pitchVel = 0;
    }
    this.yaw = ((((this.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    this.zoom += (this.targetZoom - this.zoom) * damp(7, dt);
    this.group.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    this.group.updateMatrixWorld();
  }

  /** Radians of yaw per screen pixel such that dragging tracks the surface. */
  radiansPerPixel(viewportHeight: number, fovDeg: number): number {
    const visibleHeight = 2 * Math.tan((fovDeg * Math.PI) / 360) * (this.cameraDistance - 1);
    return visibleHeight / viewportHeight;
  }

  /** Intersect a camera ray (NDC coords) with the unit sphere; returns country + lat/lon. */
  pick(ndcX: number, ndcY: number, camera: THREE.Camera, map: CountryMap): PickResult | null {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    this.inv.copy(this.group.matrixWorld).invert();
    const o = this.tmpO.copy(this.ray.ray.origin).applyMatrix4(this.inv);
    const d = this.tmpD.copy(this.ray.ray.direction).transformDirection(this.inv);
    // |o + t d|^2 = 1
    const b = o.dot(d);
    const c = o.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const p = o.addScaledVector(d, t);
    const latLon = vec3ToLatLon(p.x, p.y, p.z);
    return { country: map.indexAt(latLon.lat, latLon.lon), latLon };
  }
}
