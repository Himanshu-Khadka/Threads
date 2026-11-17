import { readFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';

export const runtimeFiles = ['main.js', 'manifest.json', 'styles.css'];
export const metadataFiles = ['package.json', 'package-lock.json', 'manifest.json', 'versions.json'];
export const plainVersion = value => typeof value === 'string' && semver.valid(value) === value && !semver.prerelease(value) && !value.includes('+');

export async function readMetadata(root) {
  const [pkg, lock, manifest, versions] = await Promise.all(metadataFiles.map(async name => JSON.parse(await readFile(path.join(root, name), 'utf8'))));
  return { pkg, lock, manifest, versions };
}

export function validateMetadata({ pkg, lock, manifest, versions }) {
  const version = manifest.version;
  if (manifest.id !== 'threads-sync') throw Error('Keep the installed plugin ID threads-sync unchanged.');
  if (!plainVersion(version) || !plainVersion(manifest.minAppVersion)) throw Error('Use plain x.y.z versions without a v prefix or prerelease suffix.');
  if (pkg.version !== version || lock.version !== version || lock.packages?.['']?.version !== version || versions[version] !== manifest.minAppVersion) {
    throw Error('Package, lockfile, manifest, and versions.json must agree.');
  }
  for (const [release, minimum] of Object.entries(versions)) {
    if (!plainVersion(release) || !plainVersion(minimum) || semver.gt(release, version)) throw Error('Invalid compatibility history.');
  }
  return version;
}

export function validateHostedConfig(env) {
  let origin;
  try { origin = new URL(env.THREADS_AUTH_ORIGIN); } catch { throw Error('Configure THREADS_AUTH_ORIGIN as a plain HTTPS origin.'); }
  if (origin.protocol !== 'https:' || origin.origin !== env.THREADS_AUTH_ORIGIN || origin.port ||
    !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.THREADS_GOOGLE_WEB_CLIENT_ID ?? '')) {
    throw Error('Configure a plain HTTPS origin and the public Google Web client ID.');
  }
}

export function nextVersion(current, requested) {
  const next = ['patch', 'minor', 'major'].includes(requested) ? semver.inc(current, requested) : requested;
  if (!plainVersion(next) || !semver.gt(next, current)) throw Error('Choose patch, minor, major, or a newer plain x.y.z version.');
  return next;
}

export function releaseAssetNames(manifest) {
  return [...runtimeFiles, `${manifest.id}-${manifest.version}.zip`, 'SHA256SUMS'];
}
