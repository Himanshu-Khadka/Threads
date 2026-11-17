import { describe, expect, it, vi } from 'vitest';
import { HostedLogin, brokerOrigin } from '../src/auth/hosted-login';
import { pkceChallenge } from '../src/platform/crypto';

describe('mobile hosted authorization', () => {
  it.each(['http://auth.example', 'https://auth.example/path', 'https://auth.example?x=1', 'https://user@auth.example'])('rejects unsafe origin %s', url => {
    expect(() => brokerOrigin(url)).toThrow();
  });
  it('polls using separate verifier and claim proof without passing either to the browser', async () => {
    let challenge = '', claimHash = '';
    const send = vi.fn(async (url: string, body: string) => {
      const data = JSON.parse(body);
      if (url.endsWith('/sessions')) {
        challenge = data.challenge; claimHash = data.claimHash;
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search = new URLSearchParams({ client_id: 'test', code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: 'https://auth.example/oauth/callback', scope: 'https://www.googleapis.com/auth/drive.file' }).toString();
        return { status: 201, text: JSON.stringify({ id: 'a'.repeat(43), authorizationUrl: auth.toString() }) };
      }
      expect(pkceChallenge(data.verifier)).toBe(challenge);
      expect(pkceChallenge(data.claimToken)).toBe(claimHash);
      return { status: 200, text: JSON.stringify({ access_token: 'test' }) };
    });
    const open = vi.fn(async (_url: string) => {});
    expect(await new HostedLogin('https://auth.example', 'test', send, open).connect()).toEqual({ access_token: 'test' });
    const claimed = JSON.parse(send.mock.calls[1]![1]);
    expect(open.mock.calls[0]![0]).not.toContain(claimed.claimToken);
    expect(open.mock.calls[0]![0]).not.toContain(claimed.verifier);
  });
  it('does not open a non-Google authorization destination', async () => {
    const open = vi.fn();
    const auth = new HostedLogin('https://auth.example', 'test', async () => ({ status: 200, text: JSON.stringify({ id: 'a'.repeat(43), authorizationUrl: 'https://evil.example' }) }), open);
    await expect(auth.connect()).rejects.toThrow('Unexpected'); expect(open).not.toHaveBeenCalled();
  });
  it('sanitizes refresh failures', async () => {
    const auth = new HostedLogin('https://auth.example', 'test', async () => ({ status: 400, text: 'private-token' }), async () => {});
    await expect(auth.refresh('test')).rejects.toThrow('HTTP 400');
  });

  it('does not accept a response after cancellation', async () => {
    const send = vi.fn(async () => {
      auth.cancel();
      return { status: 200, text: JSON.stringify({ access_token: 'late-token' }) };
    });
    const auth = new HostedLogin('https://auth.example', 'test', send, async () => {});
    await expect(auth.refresh('test')).rejects.toThrow('cancelled');
  });

  it('sanitizes network and malformed JSON responses', async () => {
    const auth = new HostedLogin('https://auth.example', 'test', async () => { throw Error('private-token'); }, async () => {});
    await expect(auth.refresh('test')).rejects.toThrow('could not be reached');
    const invalid = new HostedLogin('https://auth.example', 'test', async () => ({ status: 200, text: 'private-token' }), async () => {});
    await expect(invalid.refresh('test')).rejects.toThrow('Invalid authentication service response');
  });
});
