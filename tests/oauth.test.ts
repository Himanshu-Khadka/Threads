import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleAuth, DRIVE_SCOPE, pkceChallenge, type Credentials } from '../src/oauth';
import { GoogleHttp, type HttpRequest } from '../src/http';

const active: GoogleAuth[] = [];
afterEach(() => { for (const auth of active.splice(0)) auth.reset(); vi.useRealTimers(); });

function fixture(open: (url: string) => Promise<void> = async () => {}, timeout = 2000) {
  let credentials: Credentials = { clientId: 'test.apps.googleusercontent.com', clientSecret: 'client', refreshToken: 'refresh' };
  const tokenResponse: Record<string, unknown> = { access_token: 'access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer', scope: DRIVE_SCOPE };
  const transport = vi.fn(async (_request: HttpRequest) => ({ status: 200, text: JSON.stringify(tokenResponse) }));
  const save = vi.fn((next: Credentials) => { credentials = next; });
  const auth = new GoogleAuth(new GoogleHttp(transport), () => credentials, save, open, timeout);
  active.push(auth);
  return { auth, save, transport, tokenResponse, get: () => credentials };
}

async function callback(raw: string, params: Record<string, string>): Promise<Response> {
  const url = new URL(raw);
  const redirect = new URL(url.searchParams.get('redirect_uri')!);
  redirect.search = new URLSearchParams({ state: url.searchParams.get('state')!, ...params }).toString();
  return fetch(redirect);
}

describe('desktop authorization', () => {
  it('matches the RFC 7636 PKCE test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('uses loopback, state, PKCE, and direct token exchange', async () => {
    let authorizationUrl = '';
    const f = fixture(async raw => {
      authorizationUrl = raw;
      expect((await callback(raw, { code: 'code' })).status).toBe(200);
    });
    await f.auth.connect();
    const url = new URL(authorizationUrl);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(new URL(url.searchParams.get('redirect_uri')!).hostname).toBe('127.0.0.1');
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const request = f.transport.mock.calls[0]![0];
    const fields = new URLSearchParams(request.body);
    expect(pkceChallenge(fields.get('code_verifier')!)).toBe(url.searchParams.get('code_challenge'));
    expect(fields.get('code')).toBe('code');
    expect(request.url).toBe('https://oauth2.googleapis.com/token');
    expect(f.get().refreshToken).toBe('new-refresh');
  });

  it('rejects a wrong state without consuming the valid login', async () => {
    const f = fixture(async raw => {
      expect((await callback(raw, { code: 'bad', state: 'wrong' })).status).toBe(400);
      await callback(raw, { code: 'good' });
    });
    await f.auth.connect();
    expect(new URLSearchParams(f.transport.mock.calls[0]![0].body).get('code')).toBe('good');
  });

  it('handles denial without exchanging tokens', async () => {
    const f = fixture(async raw => { await callback(raw, { error: 'access_denied' }); });
    await expect(f.auth.connect()).rejects.toThrow('declined');
    expect(f.transport).not.toHaveBeenCalled();
  });

  it('times out without persisting a grant', async () => {
    const f = fixture(undefined, 30);
    await expect(f.auth.connect()).rejects.toThrow('timed out');
    expect(f.save).not.toHaveBeenCalled();
  });

  it('closes on cancellation', async () => {
    const f = fixture(async () => { f.auth.reset(); });
    await expect(f.auth.connect()).rejects.toThrow('cancelled');
    expect(f.transport).not.toHaveBeenCalled();
  });

  it('reports browser launch failure safely', async () => {
    const f = fixture(async () => { throw new Error('private detail'); });
    await expect(f.auth.connect()).rejects.toThrow('Could not open your default browser');
  });

  it('requires an offline grant', async () => {
    const f = fixture(async raw => { await callback(raw, { code: 'code' }); });
    delete f.tokenResponse.refresh_token;
    await expect(f.auth.connect()).rejects.toThrow('offline access');
    expect(f.save).not.toHaveBeenCalled();
  });

  it('rejects missing Drive scope', async () => {
    const f = fixture(async raw => { await callback(raw, { code: 'code' }); });
    f.tokenResponse.scope = 'openid';
    await expect(f.auth.connect()).rejects.toThrow('not granted');
    expect(f.save).not.toHaveBeenCalled();
  });

  it('shares simultaneous refreshes and caches the result', async () => {
    const f = fixture();
    expect(await Promise.all([f.auth.accessToken(), f.auth.accessToken(), f.auth.accessToken()]))
      .toEqual(['access', 'access', 'access']);
    expect(await f.auth.accessToken()).toBe('access');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it('refreshes again near expiry', async () => {
    const f = fixture();
    await f.auth.accessToken();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_550_000);
    try { await f.auth.accessToken(); expect(f.transport).toHaveBeenCalledTimes(2); }
    finally { vi.restoreAllMocks(); }
  });

  it('does not accept a refresh completed after reset', async () => {
    const f = fixture();
    f.transport.mockImplementation(async () => {
      f.auth.reset();
      return { status: 200, text: JSON.stringify(f.tokenResponse) };
    });
    await expect(f.auth.accessToken()).rejects.toThrow('Authorization changed');
  });

  it('rejects malformed tokens', async () => {
    const f = fixture(); f.tokenResponse.expires_in = '3600';
    await expect(f.auth.accessToken()).rejects.toThrow('invalid access token');
  });
});
