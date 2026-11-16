import { describe, expect, it, vi } from 'vitest';
import { assertGoogleUrl, GoogleHttp } from '../src/http';
import { safeMessage } from '../src/errors';

describe('Google transport boundary', () => {
  it.each([
    'http://www.googleapis.com/drive/v3/files', 'https://evil.example/token',
    'https://www.googleapis.com.evil.example/', 'https://user:secret@www.googleapis.com/',
    'https://www.googleapis.com:444/',
  ])('rejects %s', url => expect(() => assertGoogleUrl(url)).toThrow());

  it('allows only expected Google HTTPS hosts', () => {
    expect(() => assertGoogleUrl('https://oauth2.googleapis.com/token')).not.toThrow();
    expect(() => assertGoogleUrl('https://www.googleapis.com/drive/v3/files')).not.toThrow();
  });

  it.each([400, 401, 403, 429, 500])('does not reveal response bodies for HTTP %s', async status => {
    const http = new GoogleHttp(async () => ({ status, text: 'sensitive-refresh-token' }));
    try { await http.send({ url: 'https://oauth2.googleapis.com/token', method: 'POST' }); }
    catch (error) {
      expect(safeMessage(error)).not.toContain('sensitive-refresh-token');
      expect(safeMessage(error)).toContain('Google');
      return;
    }
    throw new Error('Expected rejection');
  });

  it('does not expose thrown transport errors', async () => {
    const http = new GoogleHttp(async () => { throw new Error('Bearer secret'); });
    await expect(http.send({ url: 'https://www.googleapis.com/drive/v3/files', method: 'GET' }))
      .rejects.toThrow('Google could not be reached');
    expect(safeMessage(new Error('secret'))).not.toContain('secret');
  });

  it('does not call transport for disallowed destinations', async () => {
    const transport = vi.fn();
    await expect(new GoogleHttp(transport).send({ url: 'https://evil.example', method: 'GET' })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON without echoing content', async () => {
    const http = new GoogleHttp(async () => ({ status: 200, text: 'secret' }));
    await expect(http.json({ url: 'https://www.googleapis.com/drive/v3/files', method: 'GET' })).rejects.toThrow('invalid response');
  });
});
