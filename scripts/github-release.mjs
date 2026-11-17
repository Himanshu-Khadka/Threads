import { createHash } from 'node:crypto';
import semver from 'semver';
import { plainVersion, releaseAssetNames } from './release-utils.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export class GitHubReleaseClient {
  constructor(repository, token, send = globalThis.fetch) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token) throw Error('GitHub repository and token are required.');
    this.repository = repository; this.token = token; this.send = send;
  }
  async request(method, route, data, { optional = false, uploadUrl } = {}) {
    const url = uploadUrl || `https://api.github.com/repos/${this.repository}${route}`;
    if (uploadUrl && new URL(uploadUrl).origin !== 'https://uploads.github.com') throw Error('Unexpected release upload destination.');
    let response;
    try {
      response = await this.send(url, { method, redirect: 'error', signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Threads-release',
          ...(data ? { 'Content-Type': uploadUrl ? 'application/octet-stream' : 'application/json' } : {}) },
        ...(data ? { body: uploadUrl ? data : JSON.stringify(data) } : {}) });
    } catch { throw Error('GitHub release request failed; retry the same workflow run.'); }
    if (optional && response.status === 404) return null;
    if (!response.ok) throw Error(`GitHub release request failed (HTTP ${response.status}); no published files were replaced.`);
    return response.json();
  }
  async list(route) {
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await this.request('GET', `${route}?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw Error('Invalid GitHub listing.');
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw Error('Release listing limit exceeded; refusing incomplete history.');
  }
  async tagCommit(version) {
    const ref = await this.request('GET', `/git/ref/tags/${version}`, undefined, { optional: true });
    if (!ref) return null;
    let object = ref.object;
    for (let depth = 0; depth < 8; depth++) {
      if (object?.type === 'commit' && /^[a-f0-9]{40}$/.test(object.sha)) return object.sha;
      if (object?.type !== 'tag' || !/^[a-f0-9]{40}$/.test(object.sha)) break;
      object = (await this.request('GET', `/git/tags/${object.sha}`)).object;
    }
    throw Error('Invalid or deeply nested release tag.');
  }
  async upload(release, name, bytes) {
    const url = new URL(release.upload_url.split('{')[0]);
    if (url.origin !== 'https://uploads.github.com' || url.pathname !== `/repos/${this.repository}/releases/${release.id}/assets` || url.username || url.password) throw Error('Unexpected release upload destination.');
    url.search = new URLSearchParams({ name }).toString();
    return this.request('POST', '', bytes, { uploadUrl: url.toString() });
  }
}

export async function planRelease(client, version, sha) {
  if (!plainVersion(version) || !/^[a-f0-9]{40}$/.test(sha)) throw Error('A valid version and exact commit SHA are required.');
  const releases = await client.list('/releases');
  const existing = releases.find(release => release.tag_name === version);
  // A normal push without a version bump must not mutate an installed release.
  if (existing && !existing.draft) return { publish: false, reason: `${version} is already published. Bump the version to distribute new code.` };
  if (releases.some(release => !release.draft && plainVersion(release.tag_name) && semver.gt(release.tag_name, version))) throw Error('Refusing to publish an older version.');
  if (existing && existing.target_commitish !== sha) throw Error('This draft belongs to a different commit. Rerun its original workflow or prepare a newer version.');
  const tagged = await client.tagCommit(version);
  if (tagged && tagged !== sha) throw Error('This version tag points to another commit. Never move a published version tag.');
  return { publish: true, release: existing };
}

function verifyAssets(remote, assets) {
  if (remote.length !== assets.length) throw Error('Unexpected or missing release assets. Keep the release as a draft.');
  for (const { name, bytes } of assets) {
    const matches = remote.filter(asset => asset.name === name);
    if (matches.length !== 1 || matches[0].state !== 'uploaded' || matches[0].size !== bytes.length || matches[0].digest !== `sha256:${sha256(bytes)}`) {
      throw Error(`Release checksum mismatch for ${name}. No existing asset was replaced.`);
    }
  }
}

export async function publishRelease(client, { version, sha, assets }) {
  const expected = releaseAssetNames({ id: 'threads-sync', version }).sort();
  if (JSON.stringify(assets.map(a => a.name).sort()) !== JSON.stringify(expected) || assets.some(a => !(a.bytes instanceof Uint8Array) || !a.bytes.length)) {
    throw Error('Publish only the complete runtime files, versioned ZIP, and checksums.');
  }
  const plan = await planRelease(client, version, sha);
  if (!plan.publish) return plan;
  let release = plan.release;
  if (!release) release = await client.request('POST', '/releases', { tag_name: version, target_commitish: sha,
    name: `Threads ${version}`, draft: true, prerelease: true, make_latest: 'false', generate_release_notes: true,
    body: 'Beta preview. Back up your vault before updating. Install with BRAT using the latest version, not a frozen tag. See docs/UPDATES.md in the repository.' });
  if (!release.draft) throw Error('Refusing to edit a published release.');
  const uploaded = await client.list(`/releases/${release.id}/assets`);
  for (const asset of uploaded) {
    const local = assets.find(item => item.name === asset.name);
    if (!local) throw Error('Unexpected draft asset; inspect the draft manually.');
    verifyAssets([asset], [local]);
  }
  for (const asset of assets) {
    if (!uploaded.some(remote => remote.name === asset.name)) await client.upload(release, asset.name, asset.bytes);
  }
  verifyAssets(await client.list(`/releases/${release.id}/assets`), assets);
  const result = await client.request('PATCH', `/releases/${release.id}`, { draft: false, prerelease: true, make_latest: 'false' });
  if (result.draft || result.tag_name !== version) throw Error('GitHub did not confirm publication. Inspect the release.');
  return { publish: true, url: result.html_url };
}
