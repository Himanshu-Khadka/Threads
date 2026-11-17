import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { sha256 } from './github-release.mjs';
import { releaseAssetNames } from './release-utils.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const names = ['main.js', 'manifest.json', 'styles.css'];
const install = (...args) => execFileSync(process.execPath, [path.join(root, 'scripts/install.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' });

test('archive contains only the three Obsidian runtime files', async () => {
  const zip = unzipSync(await readFile(path.join(root, 'dist', `${manifest.id}-${manifest.version}.zip`)));
  assert.deepEqual(Object.keys(zip).sort(), names.map(name => `${manifest.id}/${name}`).sort());
  for (const name of names) assert.deepEqual(Buffer.from(zip[`${manifest.id}/${name}`]), await readFile(path.join(root, name)));
  assert.equal(manifest.isDesktopOnly, false);
});

test('versioned package checksums match every asset and ZIP output is repeatable', async () => {
  const release = path.join(root, 'dist', 'releases', manifest.version);
  const bytes = new Map();
  for (const name of releaseAssetNames(manifest)) bytes.set(name, await readFile(path.join(release, name)));
  const sums = [...bytes].filter(([name]) => name !== 'SHA256SUMS').map(([name, body]) => `${sha256(body)}  ${name}\n`).join('');
  assert.equal(bytes.get('SHA256SUMS').toString(), sums);
  for (const name of names) assert.deepEqual(bytes.get(name), await readFile(path.join(root, name)));
  execFileSync(process.execPath, [path.join(root, 'scripts/package.mjs')], { cwd: root, stdio: 'pipe' });
  for (const [name, expected] of bytes) assert.deepEqual(await readFile(path.join(release, name)), expected);
});

test('installer rejects non-vaults and preserves data during explicit updates', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'threads-install-test-'));
  const backups = path.join(root, 'install-backups');
  let backup;
  try {
    assert.throws(() => install('--vault', temp));
    await mkdir(path.join(temp, '.obsidian'));
    install('--vault', temp);
    const plugin = path.join(temp, '.obsidian', 'plugins', manifest.id);
    assert.deepEqual((await readdir(plugin)).sort(), names.sort());
    await writeFile(path.join(plugin, 'data.json'), '{"private":"preserved"}');
    await writeFile(path.join(plugin, 'main.js'), 'previous runtime');
    assert.throws(() => install('--vault', temp), /Already installed/);
    assert.equal(await readFile(path.join(plugin, 'main.js'), 'utf8'), 'previous runtime');
    const output = install('--vault', temp, '--update');
    backup = output.split('\n').find(line => line.startsWith('Previous code backed up: '))?.slice('Previous code backed up: '.length).trim();
    assert(backup && path.dirname(backup) === backups);
    assert.equal(await readFile(path.join(plugin, 'data.json'), 'utf8'), '{"private":"preserved"}');
    assert.deepEqual(await readFile(path.join(plugin, 'main.js')), await readFile(path.join(root, 'main.js')));
    assert.equal(await readFile(path.join(backup, 'main.js'), 'utf8'), 'previous runtime');
  } finally {
    await rm(temp, { recursive: true, force: true });
    if (backup && path.dirname(backup) === backups) await rm(backup, { recursive: true, force: true });
  }
});
