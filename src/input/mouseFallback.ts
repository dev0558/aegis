import type { Action } from '../app/actions';
import { ATTACK_TYPES } from '../data/types';

export interface MouseFallbackOptions {
  /** Element that receives pointer input (the WebGL canvas). */
  target: HTMLElement;
  emit: (a: Action) => void;
  /** Radians of rotation per CSS pixel of drag at the current zoom. */
  radiansPerPixel: () => number;
  /** Is there a selectable country at this screen point? */
  isTargetAt: (x: number, y: number) => boolean;
  /** Screen point where a keyboard-triggered purge charge appears. */
  center: () => { x: number; y: number };
}

const KEY_ROTATE_SPEED = 1.1; // rad/s
const CLICK_SLOP = 6; // px
const CLICK_MAX_MS = 450;
const LONG_PRESS_MS = 350;

/**
 * Mouse, touch and keyboard → Actions. Mirrors every gesture so the app is
 * fully usable without a camera.
 */
export function attachMouseFallback(o: MouseFallbackOptions): () => void {
  const { target, emit } = o;
  const pointers = new Map<number, { x: number; y: number }>();
  let dragId: number | null = null;
  let last = { x: 0, y: 0 };
  let pinchDist = 0;
  const heldArrows = new Set<string>();
  // Press bookkeeping for click-to-select and long-press-to-charge.
  let press: { x: number; y: number; at: number; moved: boolean } | null = null;
  let longPress: ReturnType<typeof setTimeout> | null = null;
  let charging: 'pointer' | 'key' | null = null;

  const cancelLongPress = () => {
    if (longPress) clearTimeout(longPress);
    longPress = null;
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    target.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragId = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      press = { x: e.clientX, y: e.clientY, at: performance.now(), moved: false };
      // Long-press on empty space (not on a country) charges a purge.
      if (!o.isTargetAt(e.clientX, e.clientY) && !charging) {
        longPress = setTimeout(() => {
          longPress = null;
          if (!press || press.moved || dragId === null) return;
          charging = 'pointer';
          emit({ type: 'rotateRelease' });
          emit({ type: 'chargeStart', x: last.x, y: last.y });
        }, LONG_PRESS_MS);
      }
    } else if (pointers.size === 2) {
      // Two touches: switch from rotate to pinch-zoom.
      cancelLongPress();
      press = null;
      if (dragId !== null) emit({ type: 'rotateRelease' });
      dragId = null;
      pinchDist = twoPointerDistance();
    }
  };

  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      // Hovering (no button down).
      if (e.pointerType === 'mouse') emit({ type: 'hover', x: e.clientX, y: e.clientY });
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const d = twoPointerDistance();
      if (pinchDist > 0 && d > 0) emit({ type: 'zoomBy', factor: d / pinchDist });
      pinchDist = d;
      return;
    }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) {
      press.moved = true;
      cancelLongPress();
    }
    if (e.pointerId === dragId && charging === 'pointer') {
      last = { x: e.clientX, y: e.clientY };
      emit({ type: 'chargeMove', x: e.clientX, y: e.clientY });
      return;
    }
    if (e.pointerId === dragId) {
      const k = o.radiansPerPixel();
      emit({ type: 'rotateBy', yaw: (e.clientX - last.x) * k, pitch: (e.clientY - last.y) * k });
      last = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'mouse') emit({ type: 'hover', x: e.clientX, y: e.clientY });
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    cancelLongPress();
    if (e.pointerId === dragId) {
      dragId = null;
      if (charging === 'pointer') {
        charging = null;
        emit({ type: 'chargeEnd', commit: e.type === 'pointerup' });
      } else {
        emit({ type: 'rotateRelease' });
        const isClick =
          press &&
          !press.moved &&
          performance.now() - press.at < CLICK_MAX_MS &&
          e.type === 'pointerup';
        if (isClick) emit({ type: 'select', x: e.clientX, y: e.clientY });
      }
    }
    press = null;
    if (pointers.size < 2) pinchDist = 0;
  };

  const onLeave = () => {
    if (pointers.size === 0) emit({ type: 'hoverEnd' });
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // ctrlKey is set for trackpad pinch gestures, which report small deltas.
    const k = e.ctrlKey ? 0.012 : 0.0015;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    emit({ type: 'zoomBy', factor: Math.exp(-dy * k) });
  };

  const arrowVelocity = () => {
    let yaw = 0;
    let pitch = 0;
    if (heldArrows.has('ArrowLeft')) yaw -= KEY_ROTATE_SPEED;
    if (heldArrows.has('ArrowRight')) yaw += KEY_ROTATE_SPEED;
    if (heldArrows.has('ArrowUp')) pitch -= KEY_ROTATE_SPEED;
    if (heldArrows.has('ArrowDown')) pitch += KEY_ROTATE_SPEED;
    if (heldArrows.size === 0) emit({ type: 'rotateRelease' });
    else emit({ type: 'rotateVelocity', yaw, pitch });
  };

  const isTyping = (e: KeyboardEvent) =>
    e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      if (!heldArrows.has(e.key)) {
        heldArrows.add(e.key);
        arrowVelocity();
      }
      return;
    }
    if (e.key === ' ') {
      // Leave Space alone when it would activate a focused control.
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
      e.preventDefault();
      if (!e.repeat && !charging) {
        charging = 'key';
        const c = o.center();
        emit({ type: 'chargeStart', x: c.x, y: c.y });
      }
      return;
    }
    // Number keys mirror finger counts: 1–4 pick a type, 5 shows all; 6 = port scan.
    if (/^[1-6]$/.test(e.key)) {
      const n = Number(e.key);
      emit({
        type: 'setFilter',
        filter: n === 5 ? null : (ATTACK_TYPES[n === 6 ? 4 : n - 1] ?? null),
      });
      return;
    }
    switch (e.key) {
      case 'p':
      case 'P':
        emit({ type: 'togglePause' });
        break;
      case '+':
      case '=':
        emit({ type: 'zoomBy', factor: 1.18 });
        break;
      case '-':
      case '_':
        emit({ type: 'zoomBy', factor: 1 / 1.18 });
        break;
      case '0':
        emit({ type: 'resetView' });
        break;
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (heldArrows.delete(e.key)) arrowVelocity();
    if (e.key === ' ' && charging === 'key') {
      charging = null;
      emit({ type: 'chargeEnd', commit: true });
    }
  };

  const onBlur = () => {
    if (charging) {
      charging = null;
      emit({ type: 'chargeEnd', commit: false });
    }
    if (heldArrows.size) {
      heldArrows.clear();
      emit({ type: 'rotateRelease' });
    }
  };

  function twoPointerDistance(): number {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  target.addEventListener('pointerleave', onLeave);
  target.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    target.removeEventListener('pointerleave', onLeave);
    target.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
