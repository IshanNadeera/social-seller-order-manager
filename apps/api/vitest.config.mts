import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles the tests so decorator metadata is emitted, which Nest's dependency injection needs.
// (Vite's default esbuild transform does not emit it.)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
