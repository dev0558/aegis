/** Minimal typed pub/sub. */
export interface Bus<T> {
  emit(value: T): void;
  on(fn: (value: T) => void): () => void;
}

export function createBus<T>(): Bus<T> {
  const fns = new Set<(value: T) => void>();
  return {
    emit(value) {
      for (const fn of fns) fn(value);
    },
    on(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}
