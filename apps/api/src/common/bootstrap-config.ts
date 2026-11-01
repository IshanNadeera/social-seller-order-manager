// The settings the HTTP server needs to start (docs/DEVELOPMENT.md §10.4, §11.4).
// Task A7 replaces this with the Zod-validated environment for the whole API.

export interface BootstrapConfig {
  readonly port: number;
  /** Exact origin of the web app, e.g. https://app.example.com. The only origin CORS allows. */
  readonly webOrigin: string;
}

export const DEFAULT_PORT = 3000;

export function readBootstrapConfig(env: NodeJS.ProcessEnv = process.env): BootstrapConfig {
  return {
    port: parsePort(env.PORT),
    webOrigin: parseWebOrigin(env.WEB_ORIGIN),
  };
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535, got "${value}".`);
  }
  return port;
}

function parseWebOrigin(value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(
      'WEB_ORIGIN is required: the exact origin of the web app, e.g. http://localhost:5173.',
    );
  }
  const invalid = new Error(
    `WEB_ORIGIN must be an exact origin such as https://app.example.com (scheme, host and optional port; no path, no trailing slash, no wildcard), got "${value}".`,
  );
  // The URL parser accepts "*" in a host name, so wildcards are rejected explicitly.
  if (value.includes('*')) throw invalid;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid;
  }
  // Comparing with url.origin rejects paths, trailing slashes, credentials and default ports.
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== value) {
    throw invalid;
  }
  return value;
}
