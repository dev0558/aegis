import { defineConfig } from 'vitest/config';

// BASE_PATH is set by the GitHub Pages workflow (e.g. "/aegis/"); defaults to "/" locally.
export default defineConfig({
  base: process.env['BASE_PATH'] ?? '/',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~590 kB minified; it lives in its own cached chunk.
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunk (three + postprocessing) so app updates
        // don't invalidate the heaviest download.
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/](three|postprocessing)[\\/]/ }],
        },
      },
    },
  },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
