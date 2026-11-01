import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Tests that need a real database (test/**/*.db-spec.ts). Run with: npm run test:db -w apps/api.
// Separate from vitest.config.mts on purpose: the default `npm test` must never need a database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.db-spec.ts'],
    // Load apps/api/.env first, like the API does, so DATABASE_URL points at the local database.
    setupFiles: ['./src/load-env.ts'],
    // One file at a time: database tests share state.
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
