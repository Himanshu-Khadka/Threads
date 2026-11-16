import { randomUUID } from 'node:crypto';
import { GoogleHttp, record } from './http';
import { ThreadsError } from './errors';

const API = 'https://www.googleapis.com/drive/v3';
export function multipart(metadata: Record<string, unknown>, content: string, boundary: string): string {
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--\r\n`;
}

export class DriveClient {
  constructor(private http: GoogleHttp, private token: () => Promise<string>) {}

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token()}` };
  }

  private id(value: unknown): string {
    const result = record(value);
    if (typeof result.id !== 'string' || !/^[\w-]+$/.test(result.id)) throw new ThreadsError('Google returned an invalid file ID.');
    return result.id;
  }

  async account(): Promise<string> {
    const data = record(await this.http.json({
      url: `${API}/about?fields=user(emailAddress)`, method: 'GET', headers: await this.headers(),
    }));
    const user = record(data.user);
    return typeof user.emailAddress === 'string' ? user.emailAddress : 'Google account';
  }

  async createTestFolder(): Promise<string> {
    return this.id(await this.http.json({
      url: `${API}/files?fields=id`, method: 'POST',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Threads - connection tests', mimeType: 'application/vnd.google-apps.folder',
        appProperties: { threadsRole: 'connection-test' } }),
    }));
  }

  async verifyTestFolder(id: string): Promise<void> {
    return this.verifyFolder(id, 'connection-test');
  }

  async createBackupFolder(name: string): Promise<string> {
    return this.ensureFolder('root', name, 'note-copies');
  }

  async ensureChildFolder(parentId: string, name: string): Promise<string> {
    return this.ensureFolder(parentId, name, 'note-directory');
  }

  private async ensureFolder(parentId: string, name: string, role: string): Promise<string> {
    const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    const q = `${quote(parentId)} in parents and name = ${quote(name)} and trashed = false ` +
      `and mimeType = 'application/vnd.google-apps.folder' ` +
      `and appProperties has { key = 'threadsRole' and value = ${quote(role)} }`;
    const params = new URLSearchParams({ q, fields: 'files(id),nextPageToken,incompleteSearch', pageSize: '100', spaces: 'drive' });
    const found = record(await this.http.json({
      url: `${API}/files?${params}`, method: 'GET', headers: await this.headers(),
    }));
    if (!Array.isArray(found.files) || found.incompleteSearch) {
      throw new ThreadsError('Could not reliably locate the Drive folder. No upload was made.');
    }
    if (found.files.length > 1 || found.nextPageToken) {
      throw new ThreadsError(`Multiple Threads folders named "${name}" exist under the same parent. Rename the extra folders in Drive, then retry.`);
    }
    if (found.files.length === 1) return this.id(found.files[0]);
    return this.id(await this.http.json({
      url: `${API}/files?fields=id`, method: 'POST',
      headers: { ...await this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder',
        appProperties: { threadsRole: role } }),
    }));
  }

  async verifyBackupFolder(id: string): Promise<void> {
    return this.verifyFolder(id, 'note-copies');
  }

  private async verifyFolder(id: string, role: string): Promise<void> {
    const data = record(await this.http.json({
      url: `${API}/files/${encodeURIComponent(id)}?fields=id,mimeType,trashed,appProperties`,
      method: 'GET', headers: await this.headers(),
    }));
    if (data.trashed || data.mimeType !== 'application/vnd.google-apps.folder' ||
      record(data.appProperties).threadsRole !== role) {
      throw new ThreadsError('The test folder or note-copy folder is unavailable or has the wrong role. Reset its selection in settings.');
    }
  }

  async uploadMarkdown(folderId: string, name: string, content: string): Promise<string> {
    const boundary = `threads_${randomUUID()}`;
    return this.id(await this.http.json({
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      method: 'POST', headers: { ...await this.headers(), 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart({ name, parents: [folderId], mimeType: 'text/markdown' }, content, boundary),
    }));
  }

  async download(id: string): Promise<string> {
    return this.http.send({ url: `${API}/files/${encodeURIComponent(id)}?alt=media`, method: 'GET', headers: await this.headers() });
  }
}
