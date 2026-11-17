import { describe, expect, it, vi } from 'vitest';
import { DriveClient, multipart } from '../src/drive/client';
import { GoogleHttp, type HttpRequest } from '../src/drive/http';

describe('Drive client', () => {
  it('builds multipart with metadata and exact Unicode content', () => {
    const text = '# Caf\u00e9\n\n[[Knowledge]]\n';
    expect(multipart({ name: 'sample.md' }, text, 'boundary'))
      .toContain(`\r\n\r\n${text}\r\n--boundary--\r\n`);
    expect(multipart({ name: 'sample.md' }, text, 'boundary')).toContain('{"name":"sample.md"}');
  });

  it('creates a tagged test folder', async () => {
    const transport = vi.fn(async (_req: HttpRequest) => ({ status: 200, text: '{"id":"folder-123"}' }));
    const drive = new DriveClient(new GoogleHttp(transport), async () => 'token');
    expect(await drive.createTestFolder()).toBe('folder-123');
    const req = transport.mock.calls[0]![0];
    expect(req.headers?.Authorization).toBe('Bearer token');
    expect(JSON.parse(req.body!).appProperties).toEqual({ threadsRole: 'connection-test' });
  });

  it('rejects a trashed folder before writing', async () => {
    const drive = new DriveClient(new GoogleHttp(async () => ({ status: 200, text: JSON.stringify({
      trashed: true, mimeType: 'application/vnd.google-apps.folder', appProperties: { threadsRole: 'connection-test' },
    }) })), async () => 'token');
    await expect(drive.verifyTestFolder('id')).rejects.toThrow('test folder');
  });

  it('does not retry a failed create automatically', async () => {
    const transport = vi.fn(async () => ({ status: 503, text: 'unavailable' }));
    const drive = new DriveClient(new GoogleHttp(transport), async () => 'token');
    await expect(drive.createTestFolder()).rejects.toThrow('503');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('creates child folders with the correct parent and role', async () => {
    const transport = vi.fn(async (req: HttpRequest) => ({ status: 200,
      text: req.method === 'GET' ? '{"files":[]}' : '{"id":"child-id"}' }));
    const drive = new DriveClient(new GoogleHttp(transport), async () => 'token');
    expect(await drive.ensureChildFolder('parent-id', "Himanshu's notes")).toBe('child-id');
    const query = new URL(transport.mock.calls[0]![0].url).searchParams.get('q');
    expect(query).toContain("'parent-id' in parents");
    expect(query).toContain("name = 'Himanshu\\'s notes'");
    expect(query).toContain('trashed = false');
    expect(JSON.parse(transport.mock.calls[1]![0].body!)).toMatchObject({
      name: "Himanshu's notes", parents: ['parent-id'], appProperties: { threadsRole: 'note-directory' },
    });
  });

  it('reuses a matching Threads root without creating another', async () => {
    const transport = vi.fn(async (_req: HttpRequest) => ({ status: 200, text: '{"files":[{"id":"existing"}]}' }));
    const drive = new DriveClient(new GoogleHttp(transport), async () => 'token');
    expect(await drive.createBackupFolder('Threads')).toBe('existing');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(new URL(transport.mock.calls[0]![0].url).searchParams.get('q')).toContain("'root' in parents");
  });

  it.each([
    { files: [{ id: 'a' }, { id: 'b' }] },
    { files: [{ id: 'a' }], nextPageToken: 'more' },
    { files: [], incompleteSearch: true },
    {},
  ])('refuses ambiguous or incomplete folder searches: %j', async response => {
    const transport = vi.fn(async () => ({ status: 200, text: JSON.stringify(response) }));
    const drive = new DriveClient(new GoogleHttp(transport), async () => 'token');
    await expect(drive.ensureChildFolder('parent', 'Notes')).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
