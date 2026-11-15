import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import './ui/styles.css';

import { Vector3 } from 'three';
import type { Action } from './app/actions';
import { createBus } from './app/bus';
import { createStore } from './app/store';
import { SimulatedFeed } from './data/simulator';
import { FeedStats } from './data/stats';
import { countryInfo } from './data/countries';
import { ATTACK_TYPE_INFO, ATTACK_TYPES, type AttackType, type ThreatFeed } from './data/types';
import { GestureController } from './input/gestureController';
import { HandTracker, TrackerError } from './input/handTracker';
import { attachMouseFallback } from './input/mouseFallback';
import { LandmarkRecorder } from './input/recorder';
import { AttackArcs } from './scene/arcs';
import { CountryMap } from './scene/countryMap';
import { Globe } from './scene/globe';
import { FOV, Stage } from './scene/stage';
import { smoothstep } from './util/math';
import { createStars } from './scene/stars';
import { HELP_ROWS, HelpSheet } from './ui/help';
import { FpsMeter, Hud } from './ui/hud';
import { GestureIndicator } from './ui/indicator';
import { Overlay } from './ui/overlay';
import { Panel } from './ui/panel';
import { StartScreen } from './ui/startScreen';
import { Tooltip } from './ui/tooltip';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function boot(): void {
  if (!hasWebGL2()) {
    $('start').hidden = true;
    $('fatal').hidden = false;
    return;
  }

  const canvas = $('scene') as HTMLCanvasElement;
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const store = createStore({
    reducedMotion: reducedMotionQuery.matches,
    hoveredCountry: 0,
    zoom: 1,
  });
  const actions = createBus<Action>();
  const emit = (a: Action) => {
    actions.emit(a);
  };

  // ---- scene ---------------------------------------------------------------
  const stage = new Stage(canvas);
  const map = new CountryMap();
  const globe = new Globe(map);
  const arcs = new AttackArcs();
  globe.group.add(arcs.group);
  const stars = createStars();
  stage.scene.add(stars.points, globe.group);

  const applyMotion = (reduced: boolean) => {
    globe.earth.setMotion(!reduced);
    globe.autoRotate = !reduced;
    stars.setMotion(!reduced);
    arcs.setMotion(!reduced);
  };
  applyMotion(store.get().reducedMotion);
  reducedMotionQuery.addEventListener('change', (e) => {
    store.set({ reducedMotion: e.matches });
  });
  store.subscribe((s, prev) => {
    if (s.reducedMotion !== prev.reducedMotion) applyMotion(s.reducedMotion);
  });

  const t0 = performance.now();
  const sceneTime = () => (performance.now() - t0) / 1000;

  // ---- feed ----------------------------------------------------------------
  const indexCache = new Map<string, number>();
  const countryIndex = (iso: string): number => {
    let i = indexCache.get(iso);
    if (i === undefined) {
      i = map.byIsoCode(iso)?.index ?? 0;
      indexCache.set(iso, i);
    }
    return i;
  };

  const feed: ThreatFeed = new SimulatedFeed();
  const stats = new FeedStats();
  const panel = new Panel($('panel'));
  feed.subscribe((e) => {
    stats.add(e, Date.now());
    arcs.spawn(e, sceneTime(), countryIndex(e.source), countryIndex(e.target));
    panel.push(e);
  });
  feed.start();

  const pauseBtn = $('pauseBtn') as HTMLButtonElement;
  const setPaused = (p: boolean) => {
    feed.setPaused(p);
    pauseBtn.setAttribute('aria-pressed', String(p));
    pauseBtn.textContent = p ? 'Resume' : 'Pause';
    panel.setPaused(p);
    panel.note(p ? 'Feed paused' : 'Feed resumed');
  };
  pauseBtn.addEventListener('click', () => {
    setPaused(!feed.paused);
  });

  const fitGlobe = () => {
    globe.fitToAspect(window.innerWidth / window.innerHeight);
  };
  window.addEventListener('resize', fitGlobe);
  fitGlobe();

  const updateShift = () => {
    const wide = window.innerWidth > 760;
    // Centre the globe in the space left of the open panel.
    stage.setShiftTarget(wide && panel.open ? -(panel.root.offsetWidth + 34) / 2 : 0);
  };
  panel.onToggle = updateShift;
  window.addEventListener('resize', updateShift);
  updateShift();

  // ---- picking, selection, filters -----------------------------------------
  const pickAt = (x: number, y: number) =>
    globe.pick((x / stage.width) * 2 - 1, -(y / stage.height) * 2 + 1, stage.camera, map);
  const countryName = (index: number): string => {
    const c = map.byIndex(index);
    return c ? (countryInfo(c.iso)?.name ?? c.name) : '';
  };

  let selected = 0;
  const setSelected = (index: number) => {
    selected = index;
    globe.earth.setSelected(index);
    arcs.setSelected(index);
    const c = map.byIndex(index);
    panel.setCountry(c ? { iso: c.iso, name: countryName(index) } : null);
  };
  panel.onClearCountry = () => {
    setSelected(0);
  };

  let typeFilter: AttackType | null = null;
  const setTypeFilter = (f: AttackType | null) => {
    typeFilter = f;
    arcs.setTypeMask(ATTACK_TYPES.map((t) => f === null || t === f));
    panel.setTypeFilter(f);
  };
  panel.onTypeClick = (t) => {
    setTypeFilter(typeFilter === t ? null : t);
  };

  /** Screen position of the globe's centre (for the purge shockwave). */
  const globeCenter = () => {
    const v = new Vector3().applyMatrix4(globe.group.matrixWorld).project(stage.camera);
    return { x: ((v.x + 1) / 2) * stage.width, y: ((1 - v.y) / 2) * stage.height };
  };

  // ---- purge: charge then release ---------------------------------------------
  const CHARGE_TIME = 1.3; // s to full charge
  let charge: { x: number; y: number; start: number; level: number } | null = null;
  let chargeVis = 0; // smoothed contraction shown on the particles
  let burst: { start: number; strength: number } | null = null;

  const purge = (level: number) => {
    const t = sceneTime();
    const cleared = arcs.activeCount(t);
    arcs.clear();
    burst = { start: t, strength: Math.max(0.35, level) };
    const c = globeCenter();
    overlay.burst(c.x, c.y, level, performance.now(), store.get().reducedMotion);
    panel.note(`Purge · cleared ${cleared} arc${cleared === 1 ? '' : 's'}`);
  };

  // ---- UI ------------------------------------------------------------------
  const hud = new Hud(['statEps', 'statTotal', 'statActive', 'statFps']);
  const tooltip = new Tooltip($('tooltip'));
  const help = new HelpSheet(HELP_ROWS);
  $('helpBtn').addEventListener('click', () => {
    help.toggle();
  });

  // ---- hand tracking -------------------------------------------------------
  const video = $('cam') as HTMLVideoElement;
  const tracker = new HandTracker(video);
  const gestures = new GestureController({
    emit,
    zoom: () => globe.zoom,
    isTargetAt: (p) => (pickAt(p.x, p.y)?.country ?? 0) > 0,
    charge: () => charge?.level ?? 0,
  });
  tracker.onFrame = (f) => {
    gestures.onFrame(f);
  };
  if (import.meta.env.DEV) {
    // Dev-only: Shift+R records raw landmarks as a test fixture (see input/recorder.ts).
    const recorder = new LandmarkRecorder();
    gestures.onRawFrame = (f) => {
      recorder.push(f);
    };
    recorder.onChange = (on) => {
      $('indicator').toggleAttribute('data-rec', on);
    };
    window.addEventListener('keydown', (e) => {
      if (e.key === 'R' && e.shiftKey && tracker.active) recorder.toggle();
    });
  }
  const overlay = new Overlay($('overlay') as HTMLCanvasElement);
  const indicator = new GestureIndicator($('indicator'));
  const camBtn = $('camBtn') as HTMLButtonElement;
  const skelBtn = $('skelBtn') as HTMLButtonElement;

  const setWebcamBg = (on: boolean) => {
    document.body.classList.toggle('bg-on', on);
    stage.setTransparent(on);
    camBtn.setAttribute('aria-pressed', String(on));
  };
  const setSkeleton = (on: boolean) => {
    overlay.showSkeleton = on;
    skelBtn.setAttribute('aria-pressed', String(on));
  };

  const start = new StartScreen({
    onCamera: () => {
      void enableCamera();
    },
    onMouse: () => {
      start.hide();
    },
  });

  async function enableCamera(): Promise<void> {
    start.busy('Requesting camera');
    try {
      await tracker.start((s) => {
        start.busy(s === 'camera' ? 'Requesting camera' : 'Loading hand model');
      });
      start.hide();
      indicator.setVisible(true);
    } catch (e) {
      console.error('[aegis] camera start failed', e);
      if (e instanceof TrackerError) start.error(e.kind, e.message);
      else start.error('unknown', e instanceof Error ? e.message : String(e));
    }
  }

  camBtn.addEventListener('click', () => {
    if (!tracker.active) start.show();
    else setWebcamBg(!document.body.classList.contains('bg-on'));
  });
  skelBtn.addEventListener('click', () => {
    setSkeleton(!overlay.showSkeleton);
  });

  // ---- input ---------------------------------------------------------------
  attachMouseFallback({
    target: canvas,
    emit,
    radiansPerPixel: () => globe.radiansPerPixel(stage.height, FOV),
    isTargetAt: (x, y) => (pickAt(x, y)?.country ?? 0) > 0,
    center: globeCenter,
  });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || start.visible) return;
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) help.toggle();
    else if (e.key === 'Escape') {
      if (help.isOpen) help.close();
      else emit({ type: 'deselect' });
    } else if (e.key === 'l' || e.key === 'L') panel.setOpen(!panel.open);
    else if (e.key === 'h' || e.key === 'H') setSkeleton(!overlay.showSkeleton);
    else if (e.key === 'b' || e.key === 'B') camBtn.click();
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
      case 'select': {
        const idx = pickAt(a.x, a.y)?.country ?? 0;
        setSelected(idx === selected ? 0 : idx);
        break;
      }
      case 'deselect':
        setSelected(0);
        break;
      case 'chargeStart':
        charge = { x: a.x, y: a.y, start: sceneTime(), level: 0 };
        break;
      case 'chargeMove':
        if (charge) {
          charge.x = a.x;
          charge.y = a.y;
        }
        break;
      case 'chargeEnd':
        // A brief accidental hold does nothing; anything more fires the purge.
        if (charge && a.commit && charge.level >= 0.15) purge(charge.level);
        charge = null;
        break;
      case 'togglePause':
        setPaused(!feed.paused);
        break;
      case 'setFilter':
        setTypeFilter(a.filter);
        break;
    }
  });

  const tooltipFor = (index: number, lat: number, lon: number) => {
    const f = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? p : n}`;
    const iso = map.byIndex(index)?.iso ?? '';
    const s = stats.country(iso);
    const rows: [string, string][] = [];
    if (s) {
      const totals = ATTACK_TYPES.map(
        (t) => [t, s.byTargetType[t] + s.bySourceType[t]] as const,
      ).sort((a, b) => b[1] - a[1]);
      const ago = Math.max(0, Math.round((Date.now() - s.lastSeen) / 1000));
      rows.push(
        ['Targeted', s.asTarget.toLocaleString('en-US')],
        ['Origin of', s.asSource.toLocaleString('en-US')],
        ['Mostly', ATTACK_TYPE_INFO[totals[0]![0]].label],
        ['Last seen', ago < 2 ? 'now' : `${ago}s ago`],
      );
    }
    return {
      name: countryName(index),
      meta: s ? `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}` : 'No activity yet',
      rows,
      hint: index === selected ? 'Selected · Esc to clear' : 'Click or pinch to select',
    };
  };

  // ---- loop ----------------------------------------------------------------
  const fps = new FpsMeter();
  let last = performance.now();
  let slowTimer = 0;
  let heatTimer = 0;
  const heat = new Map<number, number>();

  const frame = (now: number) => {
    const frameMs = now - last;
    const dt = Math.min(1 / 20, Math.max(0.0005, frameMs / 1000));
    last = now;
    const t = (now - t0) / 1000;

    globe.update(dt);
    stage.update(dt);
    stage.camera.position.set(0, 0, globe.cameraDistance);
    stars.points.rotation.y = globe.yaw * 0.08;

    // Hover picking (once per frame, latest pointer/reticle position).
    let hovered = 0;
    if (hoverPoint && !charge) {
      const hit = pickAt(hoverPoint.x, hoverPoint.y);
      hovered = hit?.country ?? 0;
      if (hit && hovered) {
        tooltip.show(
          hoverPoint.x,
          hoverPoint.y,
          tooltipFor(hovered, hit.latLon.lat, hit.latLon.lon),
        );
      } else tooltip.hide();
    } else tooltip.hide();

    // Purge charge + burst.
    const reduced = store.get().reducedMotion;
    if (charge) charge.level = Math.min(1, (t - charge.start) / CHARGE_TIME);
    chargeVis += ((charge?.level ?? 0) - chargeVis) * (1 - Math.exp(-10 * dt));
    globe.earth.setCharge(reduced ? 0 : chargeVis);
    globe.chargeSpin = reduced ? 0 : chargeVis;
    if (burst) {
      const age = t - burst.start;
      if (age > 4.5) {
        burst = null;
        globe.earth.setBurst(-1, 0);
        globe.setBodyOpacity(0.55);
      } else {
        globe.earth.setBurst(age, burst.strength);
        // Fade the dark planet body out while particles are scattered.
        const scattered = reduced ? 0 : Math.min(1, age * 8) * (1 - smoothstep(1.2, 2.8, age));
        globe.setBodyOpacity(0.55 * (1 - scattered));
      }
    }
    store.set({ hoveredCountry: hovered, zoom: globe.zoom });

    globe.earth.setTime(t);
    globe.earth.setScale(stage.pointScale);
    globe.earth.setHover(hovered);
    arcs.update(t);
    stars.update(t, stage.dpr);

    stage.render(dt);
    stage.govern(frameMs, dt);

    // Hand-tracking overlay + indicator.
    const snap = tracker.active ? gestures.snapshot : null;
    if (snap) {
      tracker.reportRenderFrame(frameMs, dt);
      indicator.update(snap.indicator, now - snap.t > 350, tracker.targetHz, tracker.backend ?? '');
    }
    overlay.draw({
      snap,
      now,
      zoom: globe.zoom,
      charge: charge ? { x: charge.x, y: charge.y, level: charge.level } : null,
      reticleHot: hovered > 0,
      reducedMotion: reduced,
    });

    // Country heat on the particles (5 Hz).
    heatTimer += dt;
    if (heatTimer > 0.2) {
      heatTimer = 0;
      heat.clear();
      for (const [iso, score] of stats.heatEntries(Date.now())) {
        const idx = countryIndex(iso);
        if (idx) heat.set(idx, 1 - Math.exp(-score / 6));
      }
      globe.earth.setHeat(heat);
    }

    // Panel + stats (4 Hz).
    slowTimer += dt;
    if (slowTimer > 0.25) {
      slowTimer = 0;
      const wall = Date.now();
      panel.flush(stats, wall);
      hud.set('statEps', stats.eps(wall).toFixed(1));
      hud.set('statTotal', stats.total.toLocaleString('en-US'));
      hud.set('statActive', String(arcs.activeCount(t)));
    }
    if (fps.tick(dt)) hud.set('statFps', String(Math.round(fps.fps)));

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot();
