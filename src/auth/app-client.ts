import type { Credentials } from './google-auth';

declare const __THREADS_OAUTH__: { clientId: string; clientSecret: string; brokerUrl?: string } | null;

// Installed OAuth clients are public clients, not a place to keep server secrets.
export const bundledClient = typeof __THREADS_OAUTH__ === 'undefined' ? null : __THREADS_OAUTH__;

export function effectiveCredentials(stored: Credentials): Credentials {
  return stored.clientId ? stored : bundledClient ? { ...bundledClient } : stored;
}
