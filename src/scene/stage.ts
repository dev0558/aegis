import * as THREE from 'three';
import { createPostFx, type PostFx } from './postfx';
import { debugFlag } from '../util/debug';

export const FOV = 35;
const MAX_DPR = 1.75;
const MIN_DPR = 1;

/**
 * Renderer, camera, scene and post-processing, plus an adaptive pixel-ratio
 * governor: if frames run long for a sustained period, render resolution drops.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fx: PostFx;
  width = 1;
  height = 1;
  dpr = 1;
  private maxDpr: number;
  private slowTime = 0;
  private fastTime = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: !debugFlag('opaque'),
      stencil: false,
      powerPreference: 'high-performance',
    });
    // Custom shaders author display-space colours directly; skip the final
    // linear→sRGB encode so faint values are not lifted into a grey haze.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(
      new THREE.Color().setRGB(7 / 255, 7 / 255, 10 / 255, THREE.LinearSRGBColorSpace),
      1,
    );
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.camera.position.set(0, 0, 4.3);
    this.fx = createPostFx(this.renderer, this.scene, this.camera);
    this.maxDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.dpr = this.maxDpr;
    this.resize();
    window.addEventListener('resize', () => {
      this.maxDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      this.dpr = Math.min(this.dpr, this.maxDpr);
      this.resize();
    });
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.fx.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** Device-pixel scale for size-attenuated points: viewport px / (2 tan(fov/2)). */
  get pointScale(): number {
    return (this.height * this.dpr) / (2 * Math.tan((FOV * Math.PI) / 360));
  }

  /** Feed the raw frame time; lowers / restores DPR with hysteresis. */
  govern(frameMs: number, dt: number): void {
    if (frameMs > 20) {
      this.slowTime += dt;
      this.fastTime = 0;
    } else if (frameMs < 18) {
      this.fastTime += dt;
      this.slowTime = 0;
    }
    if (this.slowTime > 1.5 && this.dpr > MIN_DPR) {
      this.dpr = Math.max(MIN_DPR, this.dpr - 0.25);
      this.slowTime = 0;
      this.resize();
    } else if (this.fastTime > 6 && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.25);
      this.fastTime = 0;
      this.resize();
    }
  }

  render(dt: number): void {
    this.fx.render(dt);
  }
}
