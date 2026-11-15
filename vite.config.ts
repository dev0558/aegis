import { defineConfig } from 'vitest/config';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/aegis/"); defaults to "/" locally.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
