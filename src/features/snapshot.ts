import { randomUUID, digest, byteLength } from '../platform/crypto';
import type { DriveClient } from '../drive/client';
import { ThreadsError } from '../shared/errors';

export const MAX_NOTE_BYTES = 1024 * 1024;

export async function uploadNoteCopy(
  drive: Pick<DriveClient, 'createBackupFolder' | 'verifyBackupFolder' | 'ensureChildFolder' | 'uploadMarkdown' | 'download'>,
  note: { path: string; content: string },
  local: {
    folderName: string;
    vaultName: string;
    folderId: string;
    saveFolder: (id: string) => Promise<void>;
    ensureActive: () => void;
  },
): Promise<{ name: string; path: string; folderId: string; id: string; sha256: string }> {
  local.ensureActive();
  const parts = note.path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part)) ||
    !note.path.endsWith('.md') || !local.vaultName || /[/\\\x00-\x1f]/.test(local.vaultName)) {
    throw new ThreadsError('Invalid vault name or note path. No upload was made.');
  }
  const filename = parts.pop()!;
  if (byteLength(note.content) > MAX_NOTE_BYTES) {
    throw new ThreadsError('This desktop milestone supports note copies up to 1 MiB. No upload was made.');
  }
  let folderId = local.folderId;
  if (folderId) await drive.verifyBackupFolder(folderId);
  else {
    folderId = await drive.createBackupFolder(local.folderName);
    local.ensureActive();
    await local.saveFolder(folderId);
  }
  local.ensureActive();
  for (const directory of [local.vaultName, ...parts]) {
    folderId = await drive.ensureChildFolder(folderId, directory);
    local.ensureActive();
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${filename.slice(0, -3).slice(0, 80)} - ${stamp} - ${randomUUID().slice(0, 8)}.md`;
  const id = await drive.uploadMarkdown(folderId, name, note.content);
  local.ensureActive();
  const downloaded = await drive.download(id);
  local.ensureActive();
  if (downloaded !== note.content) {
    throw new ThreadsError('The uploaded copy failed verification. The local note was not changed.');
  }
  return { name, path: [local.folderName, local.vaultName, ...parts, name].join('/'), folderId, id,
    sha256: digest(note.content) };
}
