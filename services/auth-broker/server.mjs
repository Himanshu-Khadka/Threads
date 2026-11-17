import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const scope = 'https://www.googleapis.com/auth/drive.file';
const hash = text => createHash('sha256').update(text).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export function createBroker({ origin, clientId, clientSecret, fetchToken = globalThis.fetch, now = Date.now,
  maxSessions = 1000, rateLimit = 120, startLimit = 20 }) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.origin !== origin || base.username || base.password || !clientId || !clientSecret) throw new Error('Configure HTTPS AUTH_ORIGIN and Google Web client credentials.');
  const redirect = `${origin}/oauth/callback`;
  const sessions = new Map();
  const rates = new Map();
  const ttl = 10 * 60 * 1000;
  const sweep = () => {
    for (const [id, s] of sessions) if (s.expires <= now()) sessions.delete(id);
    for (const [ip, r] of rates) if (r.until <= now()) rates.delete(ip);
  };
  const cleanup = setInterval(sweep, 30_000); cleanup.unref();
  async function exchange(fields) {
    const response = await fetchToken('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields }),
    });
    if (!response.ok) throw new Error('Google rejected authorization');
    const data = await response.json();
    if (typeof data.access_token !== 'string' || data.token_type !== 'Bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      (data.scope && !data.scope.split(' ').includes(scope))) throw new Error('Invalid token response');
    return Object.fromEntries(['access_token', 'refresh_token', 'expires_in', 'token_type', 'scope'].filter(k => data[k] !== undefined).map(k => [k, data[k]]));
  }
  async function body(req) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('JSON required');
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > 16_384) throw new Error('Request too large'); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request');
    return value;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      sweep();
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/health') return reply(200, { status: 'ok' });
      const ip = req.socket.remoteAddress;
      if (!rates.has(ip) && rates.size >= 10_000) return reply(429, { error: 'Busy' });
      const rate = rates.get(ip) ?? { count: 0, starts: 0, until: now() + 60_000 };
      rates.set(ip, rate);
      if (++rate.count > rateLimit) return reply(429, { error: 'Rate limit' });
      if (req.method === 'GET' && url.pathname === '/oauth/callback') {
        const state = url.searchParams.get('state');
        if (!token(state)) return reply(400, { error: 'Invalid state' });
        const session = [...sessions.values()].find(s => equal(s.state, state));
        if (!session || session.received) return reply(400, { error: 'Expired or used state' });
        const code = url.searchParams.get('code');
        if (url.searchParams.has('error')) session.denied = true;
        else if (!code || code.length > 8192) return reply(400, { error: 'Invalid code' });
        else session.code = code;
        session.received = true;
        // No OAuth code or account token appears in the mobile deep link.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Threads sign-in</title><h1>Return to Threads</h1><p>Switch back to Obsidian to finish signing in.</p><a href="obsidian://threads-google-return">Open Obsidian</a></html>');
      }
      if (req.method !== 'POST') return reply(404, { error: 'Not found' });
      const data = await body(req);
      if (url.pathname === '/v1/sessions') {
        if (++rate.starts > startLimit || sessions.size >= maxSessions) return reply(429, { error: 'Too many sign-ins' });
        if (!token(data.challenge) || !token(data.claimHash)) return reply(400, { error: 'Invalid challenge' });
        const id = random(), state = random();
        sessions.set(id, { state, challenge: data.challenge, claimHash: data.claimHash, expires: now() + ttl });
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code',
          scope, access_type: 'offline', prompt: 'consent select_account', state,
          code_challenge: data.challenge, code_challenge_method: 'S256' }).toString();
        return reply(201, { id, authorizationUrl: auth.toString() });
      }
      const claim = url.pathname.match(/^\/v1\/sessions\/([\w-]{43})\/claim$/);
      if (claim) {
        const session = sessions.get(claim[1]);
        if (!session || !token(data.claimToken) || !token(data.verifier) ||
          !equal(hash(data.claimToken), session.claimHash) || !equal(hash(data.verifier), session.challenge)) return reply(403, { error: 'Invalid session proof' });
        if (session.denied) return reply(403, { error: 'Authorization declined' });
        if (!session.code) return reply(202, { status: 'pending' });
        if (session.failed) return reply(400, { error: 'Restart sign-in' });
        // Concurrent polls share one exchange. Cache its result until session expiry
        // so a lost response does not consume a second authorization code.
        if (!session.exchange) session.exchange = exchange({ grant_type: 'authorization_code', code: session.code,
          code_verifier: data.verifier, redirect_uri: redirect }).then(result => {
          if (typeof result.refresh_token !== 'string' || !result.refresh_token) throw new Error('Offline grant required');
          return result;
        }).catch(() => { session.failed = true; throw new Error('Authorization failed'); });
        return reply(200, await session.exchange);
      }
      if (url.pathname === '/v1/refresh') {
        if (typeof data.refreshToken !== 'string' || !data.refreshToken || data.refreshToken.length > 8192) return reply(400, { error: 'Invalid refresh request' });
        return reply(200, await exchange({ grant_type: 'refresh_token', refresh_token: data.refreshToken }));
      }
      reply(404, { error: 'Not found' });
    } catch { if (!res.headersSent) reply(400, { error: 'Authentication request failed. Retry sign-in.' }); else res.end(); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  server.on('close', () => clearInterval(cleanup));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createBroker({ origin: process.env.AUTH_ORIGIN, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET });
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log('Threads auth broker listening. Configure HTTPS at the reverse proxy.'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
