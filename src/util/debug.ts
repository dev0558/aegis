/** Dev-only switches via `?debug=nobloom,noatmo,…` for isolating render issues. */
const flags = new Set(
  import.meta.env.DEV
    ? (new URLSearchParams(location.search).get('debug') ?? '').split(',').filter(Boolean)
    : [],
);
export const debugFlag = (name: string): boolean => flags.has(name);
