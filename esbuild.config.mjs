import * as esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';

let client = null;
if (process.env.THREADS_AUTH_ORIGIN) {
  const origin = new URL(process.env.THREADS_AUTH_ORIGIN);
  const clientId = process.env.THREADS_GOOGLE_WEB_CLIENT_ID;
  if (origin.protocol !== 'https:' || origin.origin !== process.env.THREADS_AUTH_ORIGIN || origin.port ||
    !clientId || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Configure a plain HTTPS THREADS_AUTH_ORIGIN and THREADS_GOOGLE_WEB_CLIENT_ID.');
  }
  client = { clientId, clientSecret: '', brokerUrl: origin.origin };
} else try {
  const config = JSON.parse(await readFile(process.env.THREADS_GOOGLE_CLIENT_FILE || 'google-client.local.json', 'utf8'));
  const installed = config.installed;
  if (!installed || typeof installed.client_id !== 'string' ||
    !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(installed.client_id) ||
    typeof installed.client_secret !== 'string' || !installed.client_secret) {
    throw new Error('Use the downloaded Google Desktop app client JSON, not a Web client or account tokens.');
  }
  client = { clientId: installed.client_id, clientSecret: installed.client_secret };
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (process.env.THREADS_GOOGLE_CLIENT_FILE || process.argv.includes('--release')) {
    throw new Error('Configure hosted auth or a Desktop client. See docs/PUBLISHING.md.');
  }
}

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['obsidian', 'electron', 'node:http', 'node:crypto'],
  sourcemap: false,
  logLevel: 'info',
  define: { __THREADS_OAUTH__: JSON.stringify(client) },
});
if (process.argv.includes('--watch')) await context.watch();
else {
  await context.rebuild();
  await context.dispose();
}
