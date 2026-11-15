import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import './ui/styles.css';

import type { Action } from './app/actions';
import { createBus } from './app/bus';
import { createStore } from './app/store';
import { CountryMap } from './scene/countryMap';
import { Globe } from './scene/globe';
import { FOV, Stage } from './scene/stage';
import { createStars } from './scene/stars';
import { attachMouseFallback } from './input/mouseFallback';
import { FpsMeter, Hud } from './ui/hud';
import { HELP_ROWS, HelpSheet } from './ui/help';
import { Tooltip } from './ui/tooltip';

function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const store = createStore({
    reducedMotion: reducedMotionQuery.matches,
    hoveredCountry: 0,
    zoom: 1,
  });
  const actions = createBus<Action>();

  // ---- scene ---------------------------------------------------------------
  const stage = new Stage(canvas);
  const map = new CountryMap();
  const globe = new Globe(map);
  const stars = createStars();
  stage.scene.add(stars.points, globe.group);

  const applyMotion = (reduced: boolean) => {
    globe.earth.setMotion(!reduced);
    globe.autoRotate = !reduced;
    stars.setMotion(!reduced);
  };
  applyMotion(store.get().reducedMotion);
  reducedMotionQuery.addEventListener('change', (e) => {
    store.set({ reducedMotion: e.matches });
  });
  store.subscribe((s, prev) => {
    if (s.reducedMotion !== prev.reducedMotion) applyMotion(s.reducedMotion);
  });

  // ---- UI ------------------------------------------------------------------
  const hud = new Hud(['statParticles', 'statZoom', 'statFps']);
  hud.set('statParticles', globe.earth.count.toLocaleString('en-US'));
  const tooltip = new Tooltip(document.getElementById('tooltip')!);
  const help = new HelpSheet(HELP_ROWS);
  document.getElementById('helpBtn')!.addEventListener('click', () => {
    help.toggle();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) help.toggle();
    else if (e.key === 'Escape' && help.isOpen) help.close();
  });

  // ---- input ---------------------------------------------------------------
  attachMouseFallback({
    target: canvas,
    emit: (a) => {
      actions.emit(a);
    },
    radiansPerPixel: () => globe.radiansPerPixel(stage.height, FOV),
  });

  let hoverPoint: { x: number; y: number } | null = null;
  actions.on((a) => {
    switch (a.type) {
      case 'rotateBy':
        globe.rotateBy(a.yaw, a.pitch);
        break;
      case 'rotateVelocity':
        globe.setRotateVelocity(a.yaw, a.pitch);
        break;
      case 'rotateRelease':
        globe.release();
        break;
      case 'zoomBy':
        globe.zoomBy(a.factor);
        break;
      case 'zoomTo':
        globe.zoomTo(a.zoom);
        break;
      case 'resetView':
        globe.resetView();
        break;
      case 'hover':
        hoverPoint = { x: a.x, y: a.y };
        break;
      case 'hoverEnd':
        hoverPoint = null;
        break;
    }
  });

  // ---- loop ----------------------------------------------------------------
  const fps = new FpsMeter();
  let last = performance.now();
  const t0 = last;

  const frame = (now: number) => {
    const frameMs = now - last;
    const dt = Math.min(1 / 20, Math.max(0.0005, frameMs / 1000));
    last = now;
    const t = (now - t0) / 1000;

    globe.update(dt);
    stage.camera.position.set(0, 0, globe.cameraDistance);
    stars.points.rotation.y = globe.yaw * 0.08;

    // Hover picking (once per frame, using the latest pointer/reticle position).
    let hovered = 0;
    if (hoverPoint) {
      const nx = (hoverPoint.x / stage.width) * 2 - 1;
      const ny = -(hoverPoint.y / stage.height) * 2 + 1;
      const hit = globe.pick(nx, ny, stage.camera, map);
      hovered = hit?.country ?? 0;
      const c = map.byIndex(hovered);
      if (c && hit) {
        const { lat, lon } = hit.latLon;
        const fmt = (v: number, p: string, n: string) =>
          `${Math.abs(v).toFixed(1)}°${v >= 0 ? p : n}`;
        tooltip.show(
          hoverPoint.x,
          hoverPoint.y,
          c.name,
          `${fmt(lat, 'N', 'S')} ${fmt(lon, 'E', 'W')}`,
        );
      } else tooltip.hide();
    } else tooltip.hide();
    store.set({ hoveredCountry: hovered, zoom: globe.zoom });

    const e = globe.earth;
    e.setTime(t);
    e.setScale(stage.pointScale);
    e.setHover(hovered);
    stars.update(t, stage.dpr);

    stage.render(dt);
    stage.govern(frameMs, dt);

    if (fps.tick(dt)) {
      hud.set('statFps', String(Math.round(fps.fps)));
      hud.set('statZoom', `×${globe.zoom.toFixed(2)}`);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot();
