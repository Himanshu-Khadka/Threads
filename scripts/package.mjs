import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { readMetadata, runtimeFiles, validateMetadata } from './release-utils.mjs';

const metadata = await readMetadata(process.cwd());
validateMetadata(metadata);
const { manifest } = metadata;
const destination = `dist/${manifest.id}`;
const release = `dist/releases/${manifest.version}`;
await mkdir(destination, { recursive: true });
await mkdir(release, { recursive: true });
const archive = {};
const sums = [];
const checksum = (name, bytes) => sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
for (const file of runtimeFiles) {
  await copyFile(file, `${destination}/${file}`);
  const bytes = await readFile(file);
  await writeFile(`${release}/${file}`, bytes);
  archive[`${manifest.id}/${file}`] = new Uint8Array(bytes);
  checksum(file, bytes);
}
// Fixed local ZIP timestamp makes identical builds hash identically across hosts.
const zip = zipSync(archive, { mtime: new Date(1980, 0, 1), level: 9 });
const zipName = `${manifest.id}-${manifest.version}.zip`;
await writeFile(`dist/${zipName}`, zip);
await writeFile(`${release}/${zipName}`, zip);
checksum(zipName, zip);
await writeFile(`${release}/SHA256SUMS`, sums.join('\n') + '\n');
console.log(`Installable plugin: ${destination}`);
console.log(`Versioned release assets: ${release}`);
