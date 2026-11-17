import { access, copyFile, mkdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const index = args.indexOf('--vault');
if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('Usage: npm run install:vault -- --vault "/path/to/vault" [--update]');
const root = fileURLToPath(new URL('../', import.meta.url));
const vault = path.resolve(args[index + 1]);
await access(path.join(vault, '.obsidian'));
const { id } = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const source = path.join(root, 'dist', id);
const target = path.join(vault, '.obsidian', 'plugins', id);
const names = ['main.js', 'manifest.json', 'styles.css'];
for (const name of names) await access(path.join(source, name));
async function info(p) { try { return await lstat(p); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
for (const p of [path.join(vault, '.obsidian'), path.dirname(target), target, ...names.map(n => path.join(target, n))]) {
  if ((await info(p))?.isSymbolicLink()) throw Error('Refusing to install through a symbolic link.');
}
if (await info(target)) {
  if (!args.includes('--update')) throw Error('Already installed. Disable Threads, then rerun with --update.');
  const backup = path.join(root, 'install-backups', randomUUID()); await mkdir(backup, { recursive: true });
  for (const name of names) if (await info(path.join(target, name))) await copyFile(path.join(target, name), path.join(backup, name));
  console.log(`Previous code backed up: ${backup}`);
}
await mkdir(target, { recursive: true });
for (const name of names) await copyFile(path.join(source, name), path.join(target, name));
console.log(`Installed ${target}. data.json is unchanged. Re-enable Threads in Obsidian.`);
