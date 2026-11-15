/** Tiny observable store for UI-level state. */
export interface AppState {
  reducedMotion: boolean;
  hoveredCountry: number; // 0 = none
  zoom: number;
}

type Listener = (s: Readonly<AppState>, prev: Readonly<AppState>) => void;

export function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: (): Readonly<AppState> => state,
    set(patch: Partial<AppState>) {
      const prev = state;
      let changed = false;
      for (const k of Object.keys(patch) as (keyof AppState)[]) {
        if (patch[k] !== prev[k]) changed = true;
      }
      if (!changed) return;
      state = { ...prev, ...patch };
      for (const l of listeners) l(state, prev);
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
