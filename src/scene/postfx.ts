import {
  HalfFloatType,
  UnsignedByteType,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { debugFlag } from '../util/debug';

export interface PostFx {
  composer: EffectComposer;
  bloom: BloomEffect;
  setSize(w: number, h: number): void;
  render(dt: number): void;
}

/** Bloom via pmndrs/postprocessing (mipmap blur, merged into a single effect pass). */
export function createPostFx(renderer: WebGLRenderer, scene: Scene, camera: Camera): PostFx {
  const composer = new EffectComposer(renderer, {
    frameBufferType: debugFlag('ldr') ? UnsignedByteType : HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({
    mipmapBlur: true,
    // Ordinary land sits just under the threshold; dense limbs, highlights,
    // arcs and impacts (all > 1.0) are what bloom.
    intensity: 0.95,
    luminanceThreshold: 0.6,
    luminanceSmoothing: 0.25,
    radius: 0.62,
    levels: 5,
  });
  if (!debugFlag('nobloom')) composer.addPass(new EffectPass(camera, bloom));
  return {
    composer,
    bloom,
    setSize: (w, h) => {
      composer.setSize(w, h);
    },
    render: (dt) => {
      composer.render(dt);
    },
  };
}
