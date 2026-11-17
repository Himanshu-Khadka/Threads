import { describe, expect, it } from 'vitest';
import { loadSettings, parseCredentials, tutorialCredentials } from '../src/settings';

describe('device settings and secrets', () => {
  it('creates distinct secret references for new installations', () => {
    const a = loadSettings(null); const b = loadSettings(null);
    expect(a.credentialKey).not.toBe(b.credentialKey);
    expect(a.credentialKey).toMatch(/^threads-[a-f0-9-]{36}$/);
  });

  it('does not persist credentials accidentally found in settings', () => {
    const settings = loadSettings({ refreshToken: 'secret', clientSecret: 'private' });
    expect(JSON.stringify(settings)).not.toContain('secret');
    expect(JSON.stringify(settings)).not.toContain('private');
    expect(loadSettings(settings)).toEqual(settings);
  });

  it('rejects incompatible schemas', () => expect(() => loadSettings({ schemaVersion: 2 })).toThrow('unsupported'));
  it('reads missing credentials as disconnected', () => expect(parseCredentials(null)).toEqual({ clientId: '', clientSecret: '' }));
  it('preserves tutorial folder preferences without copying untrusted extra settings', () => {
    const data = loadSettings({ driveFolderName: 'Knowledge', accessToken: 'private' });
    expect(data.driveFolderName).toBe('Knowledge');
    expect(data.tutorialImported).toBe(false);
    expect(JSON.stringify(data)).not.toContain('private');
  });
  it('imports only client credentials, not tutorial grants', () => {
    expect(tutorialCredentials(JSON.stringify({ clientId: ' id ', clientSecret: ' secret ', refreshToken: 'old' })))
      .toEqual({ clientId: 'id', clientSecret: 'secret' });
    expect(tutorialCredentials('{')).toBeNull();
    expect(tutorialCredentials(null)).toBeNull();
    expect(tutorialCredentials('{"clientId":"","clientSecret":""}')).toBeNull();
  });
  it.each(['{', 'null', '{"clientId":12}', '{"clientId":"a","clientSecret":"b","refreshToken":2}'])
    ('rejects malformed secret %s', raw => expect(() => parseCredentials(raw)).toThrow('credentials are invalid'));
});
