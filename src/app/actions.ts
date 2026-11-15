/**
 * The single action vocabulary of the app. Both the gesture recognizer and the
 * mouse/keyboard fallback emit these; nothing downstream knows which input
 * produced an action.
 *
 * Screen coordinates are CSS pixels relative to the viewport.
 */
import type { AttackType } from '../data/types';

export type Action =
  /** Directly rotate by an angle (drag). Radians. */
  | { type: 'rotateBy'; yaw: number; pitch: number }
  /** Set rotation velocity (rad/s); inertia carries it after `rotateRelease`. */
  | { type: 'rotateVelocity'; yaw: number; pitch: number }
  | { type: 'rotateRelease' }
  /** Multiply the current zoom by a factor. */
  | { type: 'zoomBy'; factor: number }
  | { type: 'zoomTo'; zoom: number }
  | { type: 'resetView' }
  /** Pointer / reticle position for hover picking; null when nothing points. */
  | { type: 'hover'; x: number; y: number }
  | { type: 'hoverEnd' }
  /** Select the country at a screen point (empty space deselects). */
  | { type: 'select'; x: number; y: number }
  | { type: 'deselect' }
  /** Purge charge: starts at a screen point, may follow it, fires on commit. */
  | { type: 'chargeStart'; x: number; y: number }
  | { type: 'chargeMove'; x: number; y: number }
  | { type: 'chargeEnd'; commit: boolean }
  | { type: 'togglePause' }
  /** Show only one attack type (null = all). */
  | { type: 'setFilter'; filter: AttackType | null };

export type ActionType = Action['type'];
