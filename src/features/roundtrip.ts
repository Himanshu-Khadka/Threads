import { randomUUID, digest } from '../platform/crypto';
import type { DriveClient } from '../drive/client';
import { ThreadsError } from '../shared/errors';

export async function runRoundTrip(
  drive: Pick<DriveClient, 'createTestFolder' | 'verifyTestFolder' | 'uploadMarkdown' | 'download'>,
  local: {
    folderId: string;
    saveFolder: (id: string) => Promise<void>;
    createNote: (path: string, content: string) => Promise<void>;
    ensureActive: () => void;
  },
): Promise<{ localPath: string; fileId: string; sha256: string }> {
  local.ensureActive();
  let folderId = local.folderId;
  if (!folderId) {
    folderId = await drive.createTestFolder();
    local.ensureActive();
    await local.saveFolder(folderId);
  } else await drive.verifyTestFolder(folderId);
  local.ensureActive();
  const runId = randomUUID();
  const localPath = `Threads Test ${runId}.md`;
  const content = `---\nthreads_test: true\nrun_id: ${runId}\n---\n\n# Threads connection test\n\n` +
    `Created: ${new Date().toISOString()}\n\nGoogle Drive round-trip: upload, download, verify.\n\n` +
    `Link: [[Sync Test]]\n\nUnicode check: caf\u00e9, \u0928\u092e\u0938\u094d\u0924\u0947.\n`;
  const fileId = await drive.uploadMarkdown(folderId, localPath, content);
  local.ensureActive();
  const downloaded = await drive.download(fileId);
  local.ensureActive();
  if (downloaded !== content) throw new ThreadsError('Downloaded content did not match. No local note was created.');
  await local.createNote(localPath, downloaded);
  return { localPath, fileId, sha256: digest(downloaded) };
}
