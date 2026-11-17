import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareRelease } from './prepare-release.mjs';
import { metadataFiles, nextVersion, plainVersion, readMetadata, releaseAssetNames, validateHostedConfig, validateMetadata } from './release-utils.mjs';
import { GitHubReleaseClient, planRelease, publishRelease, sha256 } from './github-release.mjs';

const version = '0.4.1', sha = 'a'.repeat(40);
const assets = () => releaseAssetNames({ id: 'threads-sync', version }).map(name => ({ name, bytes: Buffer.from(`test ${name}`) }));
function fixture({ releases = [], tagged = null } = {}) {
  const state = { releases: structuredClone(releases), tagged, calls: [], failUpload: false, corruptUpload: false };
  const client = new GitHubReleaseClient('owner/Threads', 'test-only', async (url, req) => {
    const u = new URL(url), route = u.pathname.replace('/repos/owner/Threads', '');
    const body = req.body && req.headers['Content-Type'] === 'application/json' ? JSON.parse(req.body) : req.body;
    state.calls.push({ method: req.method, route, body });
    assert.equal(req.headers.Authorization, 'Bearer test-only');
    const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (route === '/releases' && req.method === 'GET') return response(state.releases);
    if (route === `/git/ref/tags/${version}`) return state.tagged ? response({ object: { type: 'commit', sha: state.tagged } }) : response({}, 404);
    if (route === '/releases' && req.method === 'POST') {
      const release = { ...body, id: 1, assets: [], upload_url: 'https://uploads.github.com/repos/owner/Threads/releases/1/assets{?name,label}' };
      state.releases.push(release); return response(release, 201);
    }
    const release = state.releases.find(r => r.id === 1);
    if (route === '/releases/1/assets' && req.method === 'GET') return response(release.assets);
    if (route === '/releases/1/assets' && req.method === 'POST') {
      if (state.failUpload) return response({ private: 'do-not-echo' }, 503);
      assert.equal(u.origin, 'https://uploads.github.com');
      const asset = { name: u.searchParams.get('name'), size: body.length, state: 'uploaded', digest: `sha256:${state.corruptUpload ? 'bad' : sha256(body)}` };
      release.assets.push(asset); return response(asset, 201);
    }
    if (route === '/releases/1' && req.method === 'PATCH') {
      assert.equal(release.assets.length, 5);
      Object.assign(release, body); state.tagged = sha;
      return response({ ...release, html_url: 'https://github.com/owner/Threads/releases/tag/0.4.1' });
    }
    throw Error(`Unexpected mock route: ${req.method} ${route}`);
  });
  return { client, state };
}

test('version helper supports semantic increments and rejects downgrades/suffixed tags', () => {
  assert.equal(nextVersion('0.4.0', 'patch'), '0.4.1');
  assert.equal(nextVersion('0.4.0', 'minor'), '0.5.0');
  assert.equal(nextVersion('0.4.0', 'major'), '1.0.0');
  assert.equal(nextVersion('0.4.0', '0.6.2'), '0.6.2');
  for (const value of ['0.3.0', '0.4.0', 'v0.5.0', '0.5.0-beta', '0.5.0+meta', '01.2.3', 'nope']) assert.throws(() => nextVersion('0.4.0', value));
  assert.equal(plainVersion(undefined), false);
});

test('prepare synchronizes four metadata files, preserving identity, dependencies and compatibility history', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'threads-version-'));
  try {
    const manifest = { id: 'threads-sync', version: '0.4.0', minAppVersion: '1.11.4', isDesktopOnly: false };
    const originals = [ { version: '0.4.0', dependencies: { example: '1.2.3' } },
      { version: '0.4.0', packages: { '': { version: '0.4.0' }, 'node_modules/example': { version: '1.2.3' } } }, manifest,
      { '0.3.0': '1.11.4', '0.4.0': '1.11.4' } ];
    for (let i = 0; i < metadataFiles.length; i++) await writeFile(path.join(root, metadataFiles[i]), JSON.stringify(originals[i]));
    const before = await Promise.all(metadataFiles.map(name => readFile(path.join(root, name), 'utf8')));
    await assert.rejects(prepareRelease(root, 'bad-version'));
    assert.deepEqual(await Promise.all(metadataFiles.map(name => readFile(path.join(root, name), 'utf8'))), before);
    assert.equal(await prepareRelease(root, 'patch'), version);
    const data = await readMetadata(root);
    assert.equal(validateMetadata(data), version);
    assert.equal(data.manifest.id, 'threads-sync');
    assert.deepEqual(data.pkg.dependencies, originals[0].dependencies);
    assert.equal(data.lock.packages['node_modules/example'].version, '1.2.3');
    assert.equal(data.versions['0.3.0'], '1.11.4');
    data.manifest.id = 'another-id'; assert.throws(() => validateMetadata(data), /ID/);
    data.manifest.id = 'threads-sync'; data.pkg.version = '1.0.0'; assert.throws(() => validateMetadata(data), /agree/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release config requires a public Web client and plain HTTPS origin', () => {
  const env = { THREADS_AUTH_ORIGIN: 'https://auth.example.invalid', THREADS_GOOGLE_WEB_CLIENT_ID: 'test.apps.googleusercontent.com' };
  validateHostedConfig(env);
  for (const origin of ['', 'http://auth.example.invalid', 'https://user@auth.example.invalid', 'https://auth.example.invalid/path', 'https://auth.example.invalid/']) {
    assert.throws(() => validateHostedConfig({ ...env, THREADS_AUTH_ORIGIN: origin }));
  }
  assert.throws(() => validateHostedConfig({ ...env, THREADS_GOOGLE_WEB_CLIENT_ID: undefined }));
});

test('normal pushes with an already published version are read-only no-ops', async () => {
  const f = fixture({ releases: [{ id: 1, tag_name: version, draft: false }] });
  assert.equal((await planRelease(f.client, version, sha)).publish, false);
  assert.equal((await publishRelease(f.client, { version, sha, assets: assets() })).publish, false);
  assert(f.state.calls.every(c => c.method === 'GET'));
});

test('new release remains a draft until all five uploaded checksums match', async () => {
  const f = fixture();
  const result = await publishRelease(f.client, { version, sha, assets: assets() });
  assert.match(result.url, /releases\/tag\/0.4.1$/);
  const writes = f.state.calls.filter(c => c.method !== 'GET');
  assert.equal(writes[0].body.draft, true);
  assert.equal(writes[0].body.target_commitish, sha);
  assert.equal(writes.at(-1).method, 'PATCH');
  assert.equal(writes.at(-1).body.draft, false);
  assert.equal(f.state.releases[0].prerelease, true);
});

test('failed uploads leave a draft and rerunning resumes without replacing existing assets', async () => {
  const f = fixture(); f.state.failUpload = true;
  await assert.rejects(publishRelease(f.client, { version, sha, assets: assets() }), /HTTP 503/);
  assert.equal(f.state.releases[0].draft, true);
  assert(!f.state.calls.some(c => c.method === 'PATCH'));
  f.state.failUpload = false;
  await f.client.upload(f.state.releases[0], assets()[0].name, assets()[0].bytes);
  f.state.calls = [];
  await publishRelease(f.client, { version, sha, assets: assets() });
  assert.equal(f.state.calls.filter(c => c.method === 'POST').length, 4);
});

test('checksum mismatch never publishes and never overwrites a mismatched asset on retry', async () => {
  const f = fixture(); f.state.corruptUpload = true;
  await assert.rejects(publishRelease(f.client, { version, sha, assets: assets() }), /checksum mismatch/);
  assert.equal(f.state.releases[0].draft, true);
  f.state.calls = []; f.state.corruptUpload = false;
  await assert.rejects(publishRelease(f.client, { version, sha, assets: assets() }), /checksum mismatch/);
  assert(f.state.calls.every(c => c.method === 'GET'));
});

test('different tag commits, foreign drafts and older releases cannot be published', async () => {
  await assert.rejects(planRelease(fixture({ tagged: 'b'.repeat(40) }).client, version, sha), /another commit/);
  await assert.rejects(planRelease(fixture({ releases: [{ tag_name: version, draft: true, target_commitish: 'b'.repeat(40) }] }).client, version, sha), /different commit/);
  await assert.rejects(planRelease(fixture({ releases: [{ tag_name: '0.5.0', draft: false }] }).client, version, sha), /older version/);
});

test('publisher refuses missing or extra assets including private settings', async () => {
  const f = fixture();
  await assert.rejects(publishRelease(f.client, { version, sha, assets: assets().slice(1) }), /complete runtime/);
  await assert.rejects(publishRelease(f.client, { version, sha, assets: [...assets(), { name: 'data.json', bytes: Buffer.from('private') }] }), /complete runtime/);
  assert.equal(f.state.calls.length, 0);
});

test('HTTP auth failures are not mistaken for a missing tag and errors omit response contents', async () => {
  const client = new GitHubReleaseClient('owner/Threads', 'test-only', async () => new Response('private-error', { status: 403 }));
  await assert.rejects(client.tagCommit(version), /HTTP 403/);
  await assert.rejects(client.tagCommit(version), error => !error.message.includes('private-error'));
});

test('listing paginates and annotated tags resolve to their commit', async () => {
  let pages = 0;
  const client = new GitHubReleaseClient('owner/Threads', 'test-only', async url => {
    const u = new URL(url);
    const data = u.pathname.endsWith('/releases') ? (++pages === 1 ? Array.from({ length: 100 }, () => ({})) : [{ tag_name: version }]) :
      u.pathname.includes('/git/ref/') ? { object: { type: 'tag', sha: 'b'.repeat(40) } } : { object: { type: 'commit', sha } };
    return new Response(JSON.stringify(data));
  });
  assert.equal((await client.list('/releases')).length, 101); assert.equal(pages, 2);
  assert.equal(await client.tagCommit(version), sha);
});

test('upload URL cannot send the GitHub token to another host or repository', async () => {
  let sent = false;
  const client = new GitHubReleaseClient('owner/Threads', 'test-only', async () => { sent = true; });
  for (const url of ['https://evil.invalid/assets', 'https://uploads.github.com/repos/attacker/project/releases/1/assets']) {
    await assert.rejects(client.upload({ id: 1, upload_url: url }, 'main.js', Buffer.from('test')), /Unexpected/);
  }
  assert.equal(sent, false);
});
