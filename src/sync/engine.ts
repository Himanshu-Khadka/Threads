import { digest, byteLength } from '../platform/crypto';
export { digest } from '../platform/crypto';
import { ThreadsError } from '../shared/errors';
import { MAX_NOTE_BYTES } from '../features/snapshot';

export const CONFLICT_DIR = '_Threads conflicts';
const MAX_NOTES = 1000;
export const MAX_REVISIONS = 5000;
export interface Revision {
  version: 1;
  id: string;
  path: string;
  parents: string[];
  hash: string;
}
export interface Baseline { path: string; heads: string[]; hash: string }
export interface SyncState {
  version: 1;
  vaultId: string;
  vaultName: string;
  accountId: string;
  clientId: string;
  baselines: Baseline[];
  pending?: { revision: Revision; content: string };
}
export interface SyncRemote {
  listRevisions(vaultId: string): Promise<Revision[]>;
  allocateId(): Promise<string>;
  putRevision(vaultId: string, revision: Revision, content: string): Promise<void>;
  readRevision(revision: Revision): Promise<string>;
}
export interface SyncLocal {
  paths(): string[];
  read(path: string): Promise<string | null>;
  replaceIfUnchanged(path: string, expected: string | null, content: string): Promise<boolean>;
  conflict(path: string, revisionId: string, content: string): Promise<void>;
  save(state: SyncState): Promise<void>;
  ensureActive(): void;
}

export const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,200}$/.test(value);
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validNotePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && value.endsWith('.md') &&
    value.split('/').every(part => !!part && !part.startsWith('.') && part.toLowerCase() !== CONFLICT_DIR.toLowerCase() &&
      !/[<>:"\\|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ThreadsError('Invalid sync metadata. Sync stopped.');
  return raw as Record<string, unknown>;
}
function ids(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 100 || !raw.every(validId) || new Set(raw).size !== raw.length) {
    throw new ThreadsError('Invalid revision parents. Sync stopped.');
  }
  return [...raw];
}
export function parseRevision(raw: unknown): Revision {
  const value = object(raw);
  if (value.version !== 1 || !validId(value.id) || !validNotePath(value.path) || !validHash(value.hash)) {
    throw new ThreadsError('Invalid cloud revision. Sync stopped without applying it.');
  }
  const parents = ids(value.parents);
  if (parents.includes(value.id)) throw new ThreadsError('A revision cannot be its own parent.');
  return { version: 1, id: value.id, path: value.path, hash: value.hash, parents };
}
export function parseSyncState(raw: unknown): SyncState | null {
  if (raw === null || raw === undefined) return null;
  const value = object(raw);
  if (value.version !== 1 || !validId(value.vaultId) || !validId(value.accountId) ||
    typeof value.vaultName !== 'string' || typeof value.clientId !== 'string' ||
    !Array.isArray(value.baselines) || value.baselines.length > MAX_NOTES) {
    throw new ThreadsError('Invalid saved sync state. Restore your plugin data backup before syncing.');
  }
  const baselines = value.baselines.map(raw => {
    const b = object(raw);
    if (!validNotePath(b.path) || !validHash(b.hash)) throw new ThreadsError('Invalid saved note baseline.');
    const heads = ids(b.heads);
    if (!heads.length) throw new ThreadsError('Missing saved note baseline.');
    return { path: b.path, hash: b.hash, heads };
  });
  if (new Set(baselines.map(b => b.path)).size !== baselines.length) throw new ThreadsError('Duplicate note baselines.');
  const state: SyncState = { version: 1, vaultId: value.vaultId, vaultName: value.vaultName,
    accountId: value.accountId, clientId: value.clientId, baselines };
  if (value.pending !== undefined) {
    const p = object(value.pending);
    const revision = parseRevision(p.revision);
    if (typeof p.content !== 'string' || byteLength(p.content) > MAX_NOTE_BYTES || digest(p.content) !== revision.hash) {
      throw new ThreadsError('The saved pending upload is damaged. Sync stopped.');
    }
    state.pending = { revision, content: p.content };
  }
  return state;
}

export function revisionHeads(revisions: Revision[]): Map<string, Revision[]> {
  if (revisions.length > MAX_REVISIONS) throw new ThreadsError('This preview supports up to 5000 retained revisions per cloud vault.');
  const byId = new Map<string, Revision>();
  for (const r of revisions) {
    parseRevision(r);
    if (byId.has(r.id)) throw new ThreadsError('Duplicate cloud revision ID.');
    byId.set(r.id, r);
  }
  const children = new Map<string, string[]>();
  const degree = new Map<string, number>();
  const referenced = new Set<string>();
  for (const r of revisions) {
    degree.set(r.id, r.parents.length);
    for (const parent of r.parents) {
      if (byId.get(parent)?.path !== r.path) throw new ThreadsError('Cloud history is incomplete or damaged. Restore missing revisions; sync will retry.');
      referenced.add(parent);
      children.set(parent, [...(children.get(parent) ?? []), r.id]);
    }
  }
  // Topological validation also rejects cycles without recursive stack growth.
  const ready = revisions.filter(r => !r.parents.length).map(r => r.id);
  for (let i = 0; i < ready.length; i++) {
    for (const child of children.get(ready[i]!) ?? []) {
      degree.set(child, degree.get(child)! - 1);
      if (!degree.get(child)) ready.push(child);
    }
  }
  if (ready.length !== revisions.length) throw new ThreadsError('Cloud history contains a cycle. Sync stopped.');
  const heads = new Map<string, Revision[]>();
  for (const r of revisions) if (!referenced.has(r.id)) heads.set(r.path, [...(heads.get(r.path) ?? []), r]);
  return heads;
}

export class SyncEngine {
  constructor(public state: SyncState, private remote: SyncRemote, private local: SyncLocal) {}

  private async checkpoint(next: SyncState): Promise<void> {
    this.local.ensureActive();
    await this.local.save(next);
    this.local.ensureActive();
    this.state = next;
  }

  private async baseline(path: string, heads: Revision[]): Promise<void> {
    await this.checkpoint({ ...this.state, baselines: [
      ...this.state.baselines.filter(b => b.path !== path),
      { path, heads: heads.map(r => r.id), hash: heads[0]!.hash },
    ] });
  }

  private async publish(path: string, content: string, parents: string[]): Promise<Revision> {
    if (byteLength(content) > MAX_NOTE_BYTES) throw new ThreadsError('Sync supports Markdown notes up to 1 MiB.');
    const id = await this.remote.allocateId();
    const revision: Revision = { version: 1, id, path, parents, hash: digest(content) };
    await this.checkpoint({ ...this.state, pending: { revision, content } });
    return this.flush();
  }

  private async flush(): Promise<Revision> {
    const { revision, content } = this.state.pending!;
    this.local.ensureActive();
    await this.remote.putRevision(this.state.vaultId, revision, content);
    this.local.ensureActive();
    const downloaded = await this.remote.readRevision(revision);
    this.local.ensureActive();
    if (downloaded !== content) throw new ThreadsError('Upload verification failed. The pending upload was retained.');
    await this.checkpoint({ ...this.state, pending: undefined, baselines: [
      ...this.state.baselines.filter(b => b.path !== revision.path),
      { path: revision.path, heads: [revision.id], hash: revision.hash },
    ] });
    return revision;
  }

  private async cloudContent(revision: Revision): Promise<string> {
    const text = await this.remote.readRevision(revision);
    this.local.ensureActive();
    if (byteLength(text) > MAX_NOTE_BYTES || digest(text) !== revision.hash) {
      throw new ThreadsError('Cloud note failed integrity verification. No local replacement was made.');
    }
    return text;
  }

  async run(resolvePath?: string): Promise<{ uploaded: number; downloaded: number; conflicts: string[]; skipped: number }> {
    this.local.ensureActive();
    let revisions = await this.remote.listRevisions(this.state.vaultId);
    this.local.ensureActive();
    revisionHeads(revisions);
    const known = new Map(revisions.map(r => [r.id, r]));
    for (const b of this.state.baselines) {
      if (b.heads.some(id => known.get(id)?.path !== b.path || known.get(id)?.hash !== b.hash)) {
        throw new ThreadsError('A previously synced revision is missing or modified in Drive. Sync paused to prevent rollback.');
      }
    }
    if (this.state.pending) {
      const pending = this.state.pending.revision;
      if (pending.parents.some(id => known.get(id)?.path !== pending.path)) throw new ThreadsError('A pending upload is missing its cloud history.');
      const done = await this.flush();
      revisions = [...revisions.filter(r => r.id !== done.id), done];
    }
    const headsByPath = revisionHeads(revisions);
    const localPaths = this.local.paths();
    const paths = new Set([...localPaths.filter(validNotePath), ...headsByPath.keys(), ...this.state.baselines.map(b => b.path)]);
    if (paths.size > MAX_NOTES) throw new ThreadsError('This sync preview supports up to 1000 Markdown notes.');
    // Case-insensitive aliases are unsafe when a vault also runs on Windows/macOS.
    const folded = new Set<string>();
    for (const path of paths) {
      const key = path.normalize('NFC').toLowerCase();
      if (folded.has(key)) throw new ThreadsError('Case or Unicode-equivalent note paths conflict. Rename them before syncing.');
      folded.add(key);
    }
    const result = { uploaded: 0, downloaded: 0, conflicts: [] as string[], skipped: localPaths.filter(p => !validNotePath(p)).length };
    for (const path of paths) {
      this.local.ensureActive();
      const content = await this.local.read(path);
      this.local.ensureActive();
      if (content !== null && byteLength(content) > MAX_NOTE_BYTES) { result.skipped++; continue; }
      const hash = content === null ? null : digest(content);
      const base = this.state.baselines.find(b => b.path === path);
      const heads = headsByPath.get(path) ?? [];
      if (content === null && base) { result.skipped++; continue; } // Local deletion never deletes or restores a remote note automatically.
      if (!heads.length) {
        if (content !== null) {
          if (revisions.length + result.uploaded >= MAX_REVISIONS) throw new ThreadsError('The preview revision limit has been reached. Existing history was retained.');
          await this.publish(path, content, []); result.uploaded++;
        }
        continue;
      }
      if (heads.length > 100) throw new ThreadsError('Too many conflicting versions. Sync stopped.');
      if (content !== null && heads.every(r => r.hash === hash)) {
        if (!base || base.hash !== hash || !sameIds(base.heads, heads.map(r => r.id))) await this.baseline(path, heads);
        continue;
      }
      if (content !== null && (resolvePath === path || (base && sameIds(base.heads, heads.map(r => r.id))))) {
        if (revisions.length + result.uploaded >= MAX_REVISIONS) throw new ThreadsError('The preview revision limit has been reached. Existing history was retained.');
        await this.publish(path, content, heads.map(r => r.id)); result.uploaded++;
        continue;
      }
      const singleContent = heads.every(r => r.hash === heads[0]!.hash);
      if (singleContent && (content === null || (base && hash === base.hash))) {
        const text = await this.cloudContent(heads[0]!);
        if (await this.local.replaceIfUnchanged(path, content, text)) {
          this.local.ensureActive();
          await this.baseline(path, heads); result.downloaded++;
        } else result.skipped++;
      } else {
        for (const r of heads) {
          if (r.hash !== hash) await this.local.conflict(path, r.id, await this.cloudContent(r));
          this.local.ensureActive();
        }
        result.conflicts.push(path);
      }
    }
    return result;
  }
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(id => b.includes(id));
}
