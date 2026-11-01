// Build-time guard used by vite.config.ts. Every VITE_ variable ends up in the browser bundle,
// so a Supabase service-role or secret key in one would be published to every visitor (§10.4, §11.2).

const SECRET_LOOKING_NAME = /SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|DATABASE_URL|DIRECT_URL/i;

/** Throws if any variable exposed to the browser looks like a secret. Never prints values. */
export function assertNoSecretsExposed(env: Record<string, string>, prefix = 'VITE_'): void {
  const offending = Object.keys(env)
    .filter((key) => key.startsWith(prefix) && SECRET_LOOKING_NAME.test(key))
    .sort();
  if (offending.length > 0) {
    throw new Error(
      `Refusing to start: ${offending.join(', ')} would be bundled into the browser app. ` +
        'Secrets such as the Supabase service-role key must never be in the web app; remove them from apps/web/.env.',
    );
  }
}
