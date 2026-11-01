import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { assertNoSecretsExposed } from './src/lib/env-guard';

export default defineConfig(({ mode }) => {
  // Refuse to start or build if a VITE_ variable looks like a secret: it would ship to every browser.
  // Run from apps/web (npm run dev -w apps/web), so the env files are read from this folder.
  assertNoSecretsExposed(loadEnv(mode, '.', 'VITE_'));

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // Fail instead of moving to another port: the API's CORS allows exactly WEB_ORIGIN (http://localhost:5173).
      strictPort: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
