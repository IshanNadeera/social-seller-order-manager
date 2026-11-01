// Vitest setup for the web app: DOM matchers (toBeInTheDocument, …) and cleanup between tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
