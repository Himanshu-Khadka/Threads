import { randomUUID } from 'node:crypto';
import { ThreadsError } from './errors';
import type { Credentials } from './oauth';
import { parseSyncState, type SyncState } from './sync';

export interface ThreadsSettings {
  schemaVersion: 1;
  credentialKey: string;
  folderId: string;
  lastTest: string;
  driveFolderName: string;
  backupFolderId: string;
  lastUpload: string;
  tutorialImported: boolean;
  autoSync: boolean;
  sync: SyncState | null;
}

export function loadSettings(raw: unknown): ThreadsSettings {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1) {
    throw new ThreadsError('This Threads settings version is unsupported. No files were changed.');
  }
  return {
    schemaVersion: 1,
    credentialKey: typeof data.credentialKey === 'string' && /^threads-[a-f0-9-]{36}$/.test(data.credentialKey)
      ? data.credentialKey : `threads-${randomUUID()}`,
    folderId: typeof data.folderId === 'string' && /^[\w-]+$/.test(data.folderId) ? data.folderId : '',
    lastTest: typeof data.lastTest === 'string' ? data.lastTest : '',
    driveFolderName: typeof data.driveFolderName === 'string' && data.driveFolderName.trim()
      ? data.driveFolderName.trim() : 'Threads',
    backupFolderId: typeof data.backupFolderId === 'string' && /^[\w-]+$/.test(data.backupFolderId) ? data.backupFolderId : '',
    lastUpload: typeof data.lastUpload === 'string' ? data.lastUpload : '',
    tutorialImported: data.tutorialImported === true,
    autoSync: data.autoSync === true,
    sync: parseSyncState(data.sync),
  };
}

export function tutorialCredentials(raw: string | null): Credentials | null {
  if (!raw) return null;
  try {
    const value = parseCredentials(raw);
    if (!value.clientId.trim() || !value.clientSecret.trim()) return null;
    // Require a fresh authorization rather than adopting unversioned tutorial tokens.
    return { clientId: value.clientId.trim(), clientSecret: value.clientSecret.trim() };
  } catch { return null; }
}

export function parseCredentials(raw: string | null): Credentials {
  if (!raw) return { clientId: '', clientSecret: '' };
  let data: unknown;
  try { data = JSON.parse(raw); }
  catch { throw new ThreadsError('Stored Threads credentials are invalid. Clear local credentials in settings.'); }
  if (!data || typeof data !== 'object') throw new ThreadsError('Stored Threads credentials are invalid. Clear local credentials in settings.');
  const value = data as Record<string, unknown>;
  if (typeof value.clientId !== 'string' || typeof value.clientSecret !== 'string' ||
    (value.refreshToken !== undefined && typeof value.refreshToken !== 'string')) {
    throw new ThreadsError('Stored Threads credentials are invalid. Clear local credentials in settings.');
  }
  return { clientId: value.clientId, clientSecret: value.clientSecret, refreshToken: value.refreshToken as string | undefined };
}
