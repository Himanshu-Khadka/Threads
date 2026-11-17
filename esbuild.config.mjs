import * as esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';

let client = null;
try {
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
    throw new Error('Public release requires a Google Desktop client file. See PUBLISHING.md.');
  }
}

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  external: ['obsidian', 'electron'],
  sourcemap: false,
  logLevel: 'info',
  define: { __THREADS_OAUTH__: JSON.stringify(client) },
});
if (process.argv.includes('--watch')) await context.watch();
else {
  await context.rebuild();
  await context.dispose();
}
