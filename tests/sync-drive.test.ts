import { describe, expect, it, vi } from 'vitest';
import { DriveClient } from '../src/drive/client';
import { GoogleHttp, type HttpRequest } from '../src/drive/http';
import { SyncDrive } from '../src/drive/sync-drive';
import { digest, type Revision } from '../src/sync/engine';

const revision: Revision = { version: 1, id: 'reserved-id', path: 'School/Note.md', hash: digest('hello'), parents: [] };
const file = { id: revision.id, mimeType: 'text/markdown', description: JSON.stringify(revision), size: '5' };
function fixture(respond: (req: HttpRequest) => { status: number; text: string }) {
  const transport = vi.fn(async (req: HttpRequest) => respond(req));
  const http = new GoogleHttp(transport);
  const folders = new DriveClient(http, async () => 'token');
  vi.spyOn(folders, 'ensureChildFolder').mockResolvedValue('child');
  const drive = new SyncDrive(http, async () => 'token', folders, () => {});
  return { transport, drive, folders };
}
const json = (value: unknown) => ({ status: 200, text: JSON.stringify(value) });

describe('sync Drive protocol', () => {
  it('reserves a Drive ID for idempotent uploads', async () => {
    const { drive, transport } = fixture(() => json({ ids: ['reserved-id'] }));
    expect(await drive.allocateId()).toBe('reserved-id');
    expect(transport.mock.calls[0]![0].url).toContain('/generateIds?');
  });
  it('uploads immutable content and path metadata using that ID', async () => {
    const { drive, transport, folders } = fixture(() => json({ id: 'reserved-id' }));
    await drive.putRevision('vault', revision, 'hello');
    expect(folders.ensureChildFolder).toHaveBeenCalledWith('vault', 'School');
    const request = transport.mock.calls[0]![0];
    expect(request.method).toBe('POST');
    expect(request.body).toContain('"id":"reserved-id"');
    expect(request.body).toContain('"parents":["child"]');
    expect(request.body).toContain('"threadsVault":"vault"');
  });
  it('accepts a duplicate-ID response but still requires content verification', async () => {
    const { drive } = fixture(req => req.method === 'POST' ? { status: 409, text: 'conflict' } :
      req.url.includes('alt=media') ? { status: 200, text: 'hello' } : json(file));
    await drive.putRevision('vault', revision, 'hello');
    expect(await drive.readRevision(revision)).toBe('hello');
  });
  it('does not ignore other upload failures', async () => {
    const { drive } = fixture(() => ({ status: 503, text: 'unavailable' }));
    await expect(drive.putRevision('vault', revision, 'hello')).rejects.toThrow('503');
  });
  it('rejects modified metadata before downloading content', async () => {
    const { drive, transport } = fixture(() => json({ ...file, description: JSON.stringify({ ...revision, path: 'Elsewhere.md' }) }));
    await expect(drive.readRevision(revision)).rejects.toThrow('metadata changed');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects remote content tampering', async () => {
    const { drive } = fixture(req => req.url.includes('alt=media') ? { status: 200, text: 'wrong' } : json(file));
    await expect(drive.readRevision(revision)).rejects.toThrow('content verification');
  });
  it('reads every page before returning revisions', async () => {
    const second: Revision = { ...revision, id: 'second-id', parents: ['reserved-id'] };
    const { drive, transport } = fixture(req => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/vault')) return json({ mimeType: 'application/vnd.google-apps.folder', trashed: false, appProperties: { threadsRole: 'sync-vault-v1' } });
      if (url.searchParams.get('pageToken')) return json({ files: [{ ...file, id: second.id, description: JSON.stringify(second) }] });
      return json({ files: [file], nextPageToken: 'second' });
    });
    expect(await drive.listRevisions('vault')).toEqual([revision, second]);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(new URL(transport.mock.calls[1]![0].url).searchParams.get('q')).toContain("value = 'vault'");
  });
  it('rejects incomplete listings and repeated pagination', async () => {
    const incomplete = fixture(() => json({ files: [], incompleteSearch: true }));
    await expect(incomplete.drive.vaults()).rejects.toThrow('incomplete');
    const repeated = fixture(() => json({ files: [], nextPageToken: 'again' }));
    await expect(repeated.drive.vaults()).rejects.toThrow('repeated');
  });
  it('refuses unsupported or trashed vaults', async () => {
    const { drive } = fixture(() => json({ mimeType: 'application/vnd.google-apps.folder', trashed: true }));
    await expect(drive.listRevisions('vault')).rejects.toThrow('unavailable');
  });
  it('binds a sync selection to the Google permission ID', async () => {
    const { drive } = fixture(() => json({ user: { permissionId: 'account-123' } }));
    expect(await drive.accountId()).toBe('account-123');
  });
});
