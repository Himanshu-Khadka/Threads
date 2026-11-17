import { describe, expect, it, vi } from 'vitest';
import { digest, parseRevision, parseSyncState, revisionHeads, SyncEngine, validNotePath, type Revision, type SyncState } from '../src/sync';

const state = (): SyncState => ({ version: 1, vaultId: 'vault', vaultName: 'Vault', accountId: 'account', clientId: 'client', baselines: [] });
function cloud() {
  const records = new Map<string, { revision: Revision; content: string }>();
  let sequence = 0;
  const remote = {
    listRevisions: vi.fn(async () => [...records.values()].map(r => structuredClone(r.revision))),
    allocateId: vi.fn(async () => `id-${++sequence}`),
    putRevision: vi.fn(async (_vault: string, revision: Revision, content: string) => {
      const existing = records.get(revision.id);
      if (existing && existing.content !== content) throw new Error('ID collision');
      records.set(revision.id, { revision: structuredClone(revision), content });
    }),
    readRevision: vi.fn(async (revision: Revision) => records.get(revision.id)!.content),
  };
  return { records, remote };
}
function device(remote: ReturnType<typeof cloud>['remote'], files: Record<string, string> = {}, saved = state()) {
  const notes = new Map(Object.entries(files));
  const conflicts = new Map<string, string>();
  let checkpoint = structuredClone(saved);
  const local = {
    paths: () => [...notes.keys()],
    read: vi.fn(async (path: string) => notes.get(path) ?? null),
    replaceIfUnchanged: vi.fn(async (path: string, expected: string | null, content: string) => {
      if ((notes.get(path) ?? null) !== expected) return false;
      notes.set(path, content); return true;
    }),
    conflict: vi.fn(async (path: string, id: string, content: string) => { conflicts.set(`${path}/${id}`, content); }),
    save: vi.fn(async (value: SyncState) => { checkpoint = structuredClone(value); }),
    ensureActive: vi.fn(),
  };
  const engine = new SyncEngine(structuredClone(checkpoint), remote, local);
  return { notes, conflicts, local, engine, saved: () => checkpoint };
}

describe('automatic Markdown reconciliation', () => {
  it('uploads notes with stable paths and does nothing when content is unchanged', async () => {
    const c = cloud(); const a = device(c.remote, { 'School/Caf\u00e9.md': '# Hello' });
    expect((await a.engine.run()).uploaded).toBe(1);
    expect((await a.engine.run()).uploaded).toBe(0);
    expect([...c.records.values()][0]!.revision.path).toBe('School/Caf\u00e9.md');
    expect(a.saved().pending).toBeUndefined();
  });
  it('downloads to a second computer and follows later revisions', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'first' }); const b = device(c.remote);
    await a.engine.run(); await b.engine.run();
    expect(b.notes.get('Note.md')).toBe('first');
    a.notes.set('Note.md', 'second'); await a.engine.run(); await b.engine.run();
    expect(b.notes.get('Note.md')).toBe('second');
    expect(c.records.size).toBe(2);
  });
  it('keeps local edits and saves conflicting cloud content until explicitly resolved', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'base' }); const b = device(c.remote);
    await a.engine.run(); await b.engine.run();
    a.notes.set('Note.md', 'from A'); await a.engine.run();
    b.notes.set('Note.md', 'from B');
    expect((await b.engine.run()).conflicts).toEqual(['Note.md']);
    expect(b.notes.get('Note.md')).toBe('from B');
    expect([...b.conflicts.values()]).toContain('from A');
    await b.engine.run('Note.md'); await a.engine.run();
    expect(a.notes.get('Note.md')).toBe('from B');
    expect(c.records.size).toBe(3);
  });
  it('preserves independent simultaneous revisions without last-writer-wins', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'A' }); const b = device(c.remote, { 'Note.md': 'B' });
    const list = c.remote.listRevisions.getMockImplementation()!;
    c.remote.listRevisions.mockResolvedValue([]);
    await a.engine.run(); await b.engine.run();
    c.remote.listRevisions.mockImplementation(list);
    expect(revisionHeads([...c.records.values()].map(r => r.revision)).get('Note.md')).toHaveLength(2);
    expect((await a.engine.run()).conflicts).toEqual(['Note.md']);
    expect((await b.engine.run()).conflicts).toEqual(['Note.md']);
    expect(a.notes.get('Note.md')).toBe('A'); expect(b.notes.get('Note.md')).toBe('B');
    await a.engine.run('Note.md'); await b.engine.run();
    expect(b.notes.get('Note.md')).toBe('A');
  });
  it('does not duplicate identical initial notes or require a conflict resolution', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'same' }); const b = device(c.remote, { 'Note.md': 'same' });
    await a.engine.run(); const result = await b.engine.run();
    expect(result.conflicts).toEqual([]); expect(result.uploaded).toBe(0);
    expect(c.records.size).toBe(1);
  });
  it('does not overwrite a different local note during first join', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'cloud' }); const b = device(c.remote, { 'Note.md': 'local' });
    await a.engine.run(); expect((await b.engine.run()).conflicts).toEqual(['Note.md']);
    expect(b.notes.get('Note.md')).toBe('local');
  });
  it('retains a persisted operation and reuses its ID after a lost upload response', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'text' });
    const put = c.remote.putRevision.getMockImplementation()!;
    c.remote.putRevision.mockImplementationOnce(async (...args) => { await put(...args); throw new Error('lost response'); });
    await expect(a.engine.run()).rejects.toThrow('lost response');
    expect(a.saved().pending).toBeDefined();
    const restarted = device(c.remote, { 'Note.md': 'text' }, a.saved());
    await restarted.engine.run();
    expect(c.records.size).toBe(1); expect(c.remote.allocateId).toHaveBeenCalledTimes(1);
    expect(restarted.saved().pending).toBeUndefined();
  });
  it('never acknowledges an edit made while an older upload is running', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'old' });
    const put = c.remote.putRevision.getMockImplementation()!;
    c.remote.putRevision.mockImplementationOnce(async (...args) => { await put(...args); a.notes.set('Note.md', 'new'); });
    await a.engine.run(); await a.engine.run();
    expect(c.records.size).toBe(2);
    expect(a.saved().baselines[0]!.hash).toBe(digest('new'));
  });
  it('does not upload before its operation has been saved durably', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'text' });
    a.local.save.mockRejectedValue(new Error('disk full'));
    await expect(a.engine.run()).rejects.toThrow('disk full');
    expect(c.remote.putRevision).not.toHaveBeenCalled();
  });
  it('retains a pending upload when verification fails', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'text' });
    c.remote.readRevision.mockResolvedValue('corrupt');
    await expect(a.engine.run()).rejects.toThrow('verification');
    expect(a.saved().pending).toBeDefined();
  });
  it('refuses damaged remote content without changing the local note', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'text' }); const b = device(c.remote);
    await a.engine.run(); c.remote.readRevision.mockResolvedValue('corrupt');
    await expect(b.engine.run()).rejects.toThrow('integrity');
    expect(b.notes.size).toBe(0);
  });
  it('preserves edits made during a download through compare-and-write', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'cloud' }); const b = device(c.remote);
    await a.engine.run();
    c.remote.readRevision.mockImplementationOnce(async () => { b.notes.set('Note.md', 'typed now'); return 'cloud'; });
    expect((await b.engine.run()).skipped).toBe(1);
    expect(b.notes.get('Note.md')).toBe('typed now');
  });
  it('does not propagate deletion or recreate a locally deleted synced note', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'text' });
    await a.engine.run(); a.notes.delete('Note.md'); await a.engine.run();
    expect(a.notes.has('Note.md')).toBe(false); expect(c.records.size).toBe(1);
  });
  it('stops if previously observed cloud history disappears', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'text' });
    await a.engine.run(); c.records.clear(); a.notes.set('Note.md', 'changed');
    await expect(a.engine.run()).rejects.toThrow('missing or modified');
    expect(c.remote.putRevision).toHaveBeenCalledTimes(1);
  });
  it('does not upload excluded paths or oversized notes', async () => {
    const c = cloud(); const a = device(c.remote, { '.obsidian/data.md': 'x', '_Threads conflicts/x.md': 'x', 'large.md': 'x'.repeat(1024 * 1024 + 1) });
    expect((await a.engine.run()).skipped).toBe(3); expect(c.records.size).toBe(0);
  });
  it('blocks case-equivalent paths before applying remote data', async () => {
    const c = cloud(); const a = device(c.remote, { 'A.md': 'cloud' }); const b = device(c.remote, { 'a.md': 'local' });
    await a.engine.run(); await expect(b.engine.run()).rejects.toThrow('equivalent');
    expect(b.notes.size).toBe(1);
  });
  it('stops applying changes after unload', async () => {
    const c = cloud(); const a = device(c.remote, { 'Note.md': 'cloud' }); const b = device(c.remote);
    await a.engine.run();
    c.remote.readRevision.mockImplementationOnce(async () => { b.local.ensureActive.mockImplementation(() => { throw new Error('unloaded'); }); return 'cloud'; });
    await expect(b.engine.run()).rejects.toThrow('unloaded'); expect(b.notes.size).toBe(0);
  });
});

describe('sync metadata validation', () => {
  const revision = (id: string, parents: string[] = []): Revision => ({ version: 1, id, parents, path: 'Note.md', hash: digest('text') });
  it.each(['../file.md', '/file.md', 'A/../file.md', '.obsidian/file.md', '_threads conflicts/file.md', 'C:/file.md', 'A\\file.md', 'CON.md', 'folder./file.md', 'a//b.md'])('rejects unsafe path %s', path => {
    expect(validNotePath(path)).toBe(false);
    expect(() => parseRevision({ ...revision('id'), path })).toThrow();
  });
  it('rejects cycles and missing parents', () => {
    expect(() => revisionHeads([revision('a', ['b']), revision('b', ['a'])])).toThrow('cycle');
    expect(() => revisionHeads([revision('a', ['missing'])])).toThrow('incomplete');
  });
  it('rejects parents from a different note', () => {
    expect(() => revisionHeads([revision('a'), { ...revision('b', ['a']), path: 'Other.md' }])).toThrow();
  });
  it('validates saved checkpoints and queued content', () => {
    expect(parseSyncState(state())).toEqual(state());
    expect(() => parseSyncState({ ...state(), pending: { revision: revision('a'), content: 'wrong' } })).toThrow('damaged');
    expect(() => parseSyncState({ ...state(), version: 9 })).toThrow();
    expect(parseSyncState(undefined)).toBeNull();
  });
});
