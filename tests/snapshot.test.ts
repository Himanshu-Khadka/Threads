import { describe, expect, it, vi } from 'vitest';
import { MAX_NOTE_BYTES, uploadNoteCopy } from '../src/snapshot';

function fixture(folderId = '') {
  let content = '';
  const drive = {
    createBackupFolder: vi.fn(async (_name: string) => 'folder'),
    verifyBackupFolder: vi.fn(async (_id: string) => {}),
    ensureChildFolder: vi.fn(async (parent: string, name: string) => `${parent}/${name}`),
    uploadMarkdown: vi.fn(async (_folder: string, _name: string, text: string) => { content = text; return 'file-id'; }),
    download: vi.fn(async (_id: string) => content),
  };
  const local = { folderName: 'Knowledge', vaultName: 'My Vault', folderId, saveFolder: vi.fn(async (_id: string) => {}), ensureActive: vi.fn() };
  return { drive, local };
}

describe('manual note copies', () => {
  it('creates the configured folder and verifies exact Unicode text', async () => {
    const { drive, local } = fixture();
    const note = { path: 'Caf\u00e9.md', content: '# Hello\n\u0928\u092e\u0938\u094d\u0924\u0947\n[[Link]]\n' };
    const result = await uploadNoteCopy(drive, note, local);
    expect(drive.createBackupFolder).toHaveBeenCalledWith('Knowledge');
    expect(local.saveFolder).toHaveBeenCalledWith('folder');
    expect(drive.uploadMarkdown).toHaveBeenCalledWith('folder/My Vault', result.name, note.content);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('validates existing folders and makes uniquely named copies', async () => {
    const { drive, local } = fixture('existing');
    const note = { path: 'Same.md', content: 'text' };
    const first = await uploadNoteCopy(drive, note, local);
    const second = await uploadNoteCopy(drive, note, local);
    expect(first.name).not.toBe(second.name);
    expect(drive.verifyBackupFolder).toHaveBeenCalledWith('existing');
    expect(drive.createBackupFolder).not.toHaveBeenCalled();
  });
  it('rejects oversized UTF-8 content before any remote work', async () => {
    const { drive, local } = fixture();
    await expect(uploadNoteCopy(drive, { path: 'Large.md', content: '\u00e9'.repeat(MAX_NOTE_BYTES) }, local))
      .rejects.toThrow('1 MiB');
    expect(drive.createBackupFolder).not.toHaveBeenCalled();
    expect(drive.uploadMarkdown).not.toHaveBeenCalled();
  });
  it('does not report a corrupt copy as verified', async () => {
    const { drive, local } = fixture(); drive.download.mockResolvedValue('wrong');
    await expect(uploadNoteCopy(drive, { path: 'Note.md', content: 'right' }, local)).rejects.toThrow('failed verification');
  });
  it('does not upload if saving the folder checkpoint fails', async () => {
    const { drive, local } = fixture(); local.saveFolder.mockRejectedValue(new Error('full'));
    await expect(uploadNoteCopy(drive, { path: 'Note.md', content: 'text' }, local)).rejects.toThrow('full');
    expect(drive.uploadMarkdown).not.toHaveBeenCalled();
  });
  it('stops after an in-flight upload if the plugin unloads', async () => {
    const { drive, local } = fixture('existing');
    drive.uploadMarkdown.mockImplementation(async () => {
      local.ensureActive.mockImplementation(() => { throw new Error('unloaded'); });
      return 'file';
    });
    await expect(uploadNoteCopy(drive, { path: 'Note.md', content: 'text' }, local)).rejects.toThrow('unloaded');
    expect(drive.download).not.toHaveBeenCalled();
  });
  it('preserves nested folders below the vault folder', async () => {
    const { drive, local } = fixture('existing');
    const result = await uploadNoteCopy(drive, { path: 'School/Course/Note.md', content: 'text' }, local);
    expect(drive.ensureChildFolder.mock.calls).toEqual([
      ['existing', 'My Vault'], ['existing/My Vault', 'School'], ['existing/My Vault/School', 'Course'],
    ]);
    expect(result.path).toBe(`Knowledge/My Vault/School/Course/${result.name}`);
    expect(drive.uploadMarkdown).toHaveBeenCalledWith('existing/My Vault/School/Course', result.name, 'text');
  });
  it.each(['../Note.md', '/Note.md', 'A//Note.md', 'A/./Note.md', 'A\\Note.md'])('rejects invalid path %s', async path => {
    const { drive, local } = fixture();
    await expect(uploadNoteCopy(drive, { path, content: 'text' }, local)).rejects.toThrow('Invalid');
    expect(drive.createBackupFolder).not.toHaveBeenCalled();
  });
  it('does not upload after a child-folder failure', async () => {
    const { drive, local } = fixture('existing');
    drive.ensureChildFolder.mockRejectedValue(new Error('folder failed'));
    await expect(uploadNoteCopy(drive, { path: 'A/Note.md', content: 'text' }, local)).rejects.toThrow('folder failed');
    expect(drive.uploadMarkdown).not.toHaveBeenCalled();
  });
});
