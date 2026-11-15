/**
 * The single action vocabulary of the app. Both the gesture recognizer and the
 * mouse/keyboard fallback emit these; nothing downstream knows which input
 * produced an action.
 *
 * Screen coordinates are CSS pixels relative to the viewport.
 */
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
  | { type: 'hoverEnd' };

export type ActionType = Action['type'];
