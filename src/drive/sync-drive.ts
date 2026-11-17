import { randomUUID, digest, byteLength } from '../platform/crypto';
import { DriveClient, multipart } from './client';
import { GoogleHttp, GoogleHttpError, record } from './http';
import { ThreadsError } from '../shared/errors';
import { MAX_NOTE_BYTES } from '../features/snapshot';
import { MAX_REVISIONS, parseRevision, validId, type Revision, type SyncRemote } from '../sync/engine';

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
export interface CloudVault { id: string; name: string }

export class SyncDrive implements SyncRemote {
  constructor(private http: GoogleHttp, private token: () => Promise<string>, private folders: DriveClient,
    private active: () => void) {}

  private async headers(): Promise<Record<string, string>> {
    this.active();
    const token = await this.token();
    this.active();
    return { Authorization: `Bearer ${token}` };
  }

  async accountId(): Promise<string> {
    const data = record(await this.http.json({ url: `${API}/about?fields=user(permissionId)`, method: 'GET', headers: await this.headers() }));
    const id = record(data.user).permissionId;
    if (!validId(id)) throw new ThreadsError('Could not identify this Google account. Sync has not started.');
    return id;
  }

  private async list(q: string, fields: string, limit: number): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [];
    const tokens = new Set<string>();
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, spaces: 'drive', pageSize: '1000', fields: `nextPageToken,incompleteSearch,files(${fields})` });
      if (pageToken) params.set('pageToken', pageToken);
      const data = record(await this.http.json({ url: `${API}/files?${params}`, method: 'GET', headers: await this.headers() }));
      this.active();
      if (!Array.isArray(data.files) || data.incompleteSearch || (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string')) {
        throw new ThreadsError('Drive returned an incomplete file listing. Sync stopped.');
      }
      result.push(...data.files.map(record));
      if (result.length > limit) throw new ThreadsError(`This preview supports up to ${limit} cloud items per listing.`);
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      if (pageToken && tokens.has(pageToken)) throw new ThreadsError('Drive repeated a page token. Sync stopped.');
      tokens.add(pageToken);
    } while (pageToken);
    return result;
  }

  async vaults(): Promise<CloudVault[]> {
    const files = await this.list(`trashed = false and mimeType = '${FOLDER}' and appProperties has { key = 'threadsRole' and value = 'sync-vault-v1' }`, 'id,name', 1000);
    return files.map(file => {
      if (!validId(file.id) || typeof file.name !== 'string') throw new ThreadsError('Invalid cloud vault.');
      return { id: file.id, name: file.name };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  async createVault(name: string): Promise<CloudVault> {
    if (!name.trim() || name.length > 150) throw new ThreadsError('Choose a vault name of 1 to 150 characters.');
    const parent = await this.folders.createBackupFolder('Threads');
    this.active();
    const data = record(await this.http.json({ url: `${API}/files?fields=id`, method: 'POST',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent], appProperties: { threadsRole: 'sync-vault-v1' } }),
    }));
    if (!validId(data.id)) throw new ThreadsError('Drive returned an invalid vault ID.');
    return { id: data.id, name };
  }

  async listRevisions(vaultId: string): Promise<Revision[]> {
    if (!validId(vaultId)) throw new ThreadsError('Invalid cloud vault ID.');
    const folder = record(await this.http.json({ url: `${API}/files/${vaultId}?fields=mimeType,trashed,appProperties`, method: 'GET', headers: await this.headers() }));
    if (folder.trashed || folder.mimeType !== FOLDER || record(folder.appProperties).threadsRole !== 'sync-vault-v1') {
      throw new ThreadsError('The selected cloud vault is unavailable. Sync stopped.');
    }
    const files = await this.list(`trashed = false and appProperties has { key = 'threadsRole' and value = 'revision-v1' } and appProperties has { key = 'threadsVault' and value = '${vaultId}' }`,
      'id,description,size,mimeType', MAX_REVISIONS);
    return files.map(file => this.metadata(file));
  }

  private metadata(file: Record<string, unknown>): Revision {
    if (file.mimeType !== 'text/markdown' || typeof file.description !== 'string' ||
      !Number.isFinite(Number(file.size)) || Number(file.size) < 0 || Number(file.size) > MAX_NOTE_BYTES || file.trashed) {
      throw new ThreadsError('A cloud revision has invalid metadata or exceeds the note size limit.');
    }
    let description: unknown;
    try { description = JSON.parse(file.description); }
    catch { throw new ThreadsError('A cloud revision has damaged metadata.'); }
    const revision = parseRevision(description);
    if (revision.id !== file.id) throw new ThreadsError('Cloud revision identity mismatch.');
    return revision;
  }

  async allocateId(): Promise<string> {
    const data = record(await this.http.json({ url: `${API}/files/generateIds?count=1&space=drive&type=files`, method: 'GET', headers: await this.headers() }));
    if (!Array.isArray(data.ids) || !validId(data.ids[0])) throw new ThreadsError('Could not reserve an upload ID.');
    return data.ids[0];
  }

  async putRevision(vaultId: string, revision: Revision, content: string): Promise<void> {
    parseRevision(revision);
    if (!validId(vaultId) || digest(content) !== revision.hash || byteLength(content) > MAX_NOTE_BYTES) {
      throw new ThreadsError('Invalid pending revision.');
    }
    let parent = vaultId;
    const parts = revision.path.split('/');
    const filename = parts.pop()!;
    for (const part of parts) {
      this.active();
      parent = await this.folders.ensureChildFolder(parent, part);
    }
    this.active();
    const boundary = `threads_${randomUUID()}`;
    try {
      await this.http.json({ url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        method: 'POST', headers: { ...await this.headers(), 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipart({ id: revision.id, name: `${filename.slice(0, -3)} - ${revision.id}.md`, parents: [parent],
          mimeType: 'text/markdown', description: JSON.stringify(revision),
          appProperties: { threadsRole: 'revision-v1', threadsVault: vaultId } }, content, boundary),
      });
    } catch (error) {
      // A retry of the same preallocated ID can only succeed once. The caller
      // verifies the existing metadata and bytes before acknowledging a 409.
      if (!(error instanceof GoogleHttpError && error.status === 409)) throw error;
    }
  }

  async readRevision(revision: Revision): Promise<string> {
    const file = record(await this.http.json({ url: `${API}/files/${revision.id}?fields=id,description,size,mimeType,trashed`, method: 'GET', headers: await this.headers() }));
    const actual = this.metadata(file);
    if (JSON.stringify(actual) !== JSON.stringify(parseRevision(revision))) throw new ThreadsError('Cloud revision metadata changed. Sync stopped.');
    const text = await this.http.send({ url: `${API}/files/${revision.id}?alt=media`, method: 'GET', headers: await this.headers() });
    if (digest(text) !== revision.hash || byteLength(text) > MAX_NOTE_BYTES) throw new ThreadsError('Cloud revision failed content verification.');
    return text;
  }
}
