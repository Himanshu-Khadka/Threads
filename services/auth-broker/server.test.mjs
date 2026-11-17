import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createBroker } from './server.mjs';

const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('base64url');
async function fixture(t, options = {}) {
  const calls = []; let time = Date.now();
  const server = createBroker({ origin: 'https://auth.example.invalid', clientId: 'test.apps.googleusercontent.com', clientSecret: 'test-only', now: () => time,
    fetchToken: async (url, request) => {
      calls.push({ url, fields: new URLSearchParams(request.body) });
      return { ok: true, json: async () => ({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, token_type: 'Bearer' }) };
    }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  async function session() {
    const verifier = random(), claimToken = random();
    const response = await post('/v1/sessions', { challenge: hash(verifier), claimHash: hash(claimToken) });
    assert.equal(response.status, 201);
    const data = await response.json();
    const state = new URL(data.authorizationUrl).searchParams.get('state');
    return { ...data, state, verifier, claimToken, claim: `/v1/sessions/${data.id}/claim` };
  }
  return { post, session, calls, origin, advance: ms => { time += ms; } };
}
test('independent sign-in binds state, verifier and polling proof; retries do not exchange twice', async t => {
  const f = await fixture(t); const s = await f.session();
  const auth = new URL(s.authorizationUrl);
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://auth.example.invalid/oauth/callback');
  assert.equal(auth.searchParams.get('code_challenge'), hash(s.verifier));
  assert(!s.authorizationUrl.includes(s.claimToken));
  assert.equal((await f.post(s.claim, s)).status, 202);
  const response = await fetch(`${f.origin}/oauth/callback?state=${s.state}&code=example-code`);
  const html = await response.text();
  assert(!html.includes('example-code')); assert(html.includes('obsidian://threads-google-return'));
  const [a, b] = await Promise.all([f.post(s.claim, s), f.post(s.claim, s)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(f.calls.length, 1);
  assert.equal((await a.json()).refresh_token, 'test-refresh');
  assert.equal(f.calls[0].fields.get('code_verifier'), s.verifier);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${f.origin}/oauth/callback?state=${s.state}&code=another`)).status, 400);
});
test('unknown state, wrong claim token, and wrong verifier cannot obtain credentials', async t => {
  const f = await fixture(t); const s = await f.session();
  assert.equal((await fetch(`${f.origin}/oauth/callback?state=${random()}&code=x`)).status, 400);
  assert.equal((await f.post(s.claim, { ...s, claimToken: random() })).status, 403);
  assert.equal((await f.post(s.claim, { ...s, verifier: random() })).status, 403);
  assert.equal(f.calls.length, 0);
});
test('expired and denied sessions cannot exchange', async t => {
  const f = await fixture(t); const s = await f.session();
  await fetch(`${f.origin}/oauth/callback?state=${s.state}&error=access_denied`);
  assert.equal((await f.post(s.claim, s)).status, 403);
  const other = await f.session(); f.advance(601_000);
  assert.equal((await f.post(other.claim, other)).status, 403);
  assert.equal(f.calls.length, 0);
});
test('refresh uses the server Web client and does not accept caller-controlled destinations', async t => {
  const f = await fixture(t);
  const r = await f.post('/v1/refresh', { refreshToken: 'test-refresh', url: 'https://evil.invalid', clientSecret: 'attacker' });
  assert.equal(r.status, 200);
  assert.equal(f.calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(f.calls[0].fields.get('client_secret'), 'test-only');
});
test('invalid and oversized bodies fail without echoing payloads', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/v1/sessions', { challenge: 'bad' })).status, 400);
  const response = await f.post('/v1/refresh', { refreshToken: 'private'.repeat(4000) });
  assert.equal(response.status, 400); assert(!(await response.text()).includes('private'));
});
test('session and request limits bound resource usage', async t => {
  const f = await fixture(t, { maxSessions: 1 }); await f.session();
  assert.equal((await f.post('/v1/sessions', { challenge: hash(random()), claimHash: hash(random()) })).status, 429);
  const limited = await fixture(t, { rateLimit: 1 });
  await limited.post('/v1/refresh', { refreshToken: 'a' });
  assert.equal((await limited.post('/v1/refresh', { refreshToken: 'a' })).status, 429);
});
test('provider failures are sanitized and require a new session', async t => {
  const f = await fixture(t, { fetchToken: async () => { throw Error('private-provider-body'); } });
  const s = await f.session(); await fetch(`${f.origin}/oauth/callback?state=${s.state}&code=x`);
  const result = await f.post(s.claim, s); assert.equal(result.status, 400);
  assert(!(await result.text()).includes('private-provider-body'));
  assert.equal((await f.post(s.claim, s)).status, 400);
});
