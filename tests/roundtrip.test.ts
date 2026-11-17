import { describe, expect, it, vi } from 'vitest';
import { runRoundTrip } from '../src/roundtrip';

function fixture(folderId = '') {
  let uploaded = '';
  const drive = {
    createTestFolder: vi.fn(async () => 'folder'),
    verifyTestFolder: vi.fn(async () => {}),
    uploadMarkdown: vi.fn(async (_folder: string, _name: string, content: string) => { uploaded = content; return 'file'; }),
    download: vi.fn(async () => uploaded),
  };
  const local = { folderId, saveFolder: vi.fn(async () => {}), createNote: vi.fn(async (_path: string, _content: string) => {}), ensureActive: vi.fn() };
  return { drive, local };
}

describe('non-destructive sample test', () => {
  it('persists the folder and creates an exact downloaded note', async () => {
    const { drive, local } = fixture();
    const result = await runRoundTrip(drive, local);
    expect(local.saveFolder).toHaveBeenCalledWith('folder');
    expect(result.localPath).toMatch(/^Threads Test [a-f0-9-]+\.md$/);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(local.createNote).toHaveBeenCalledWith(result.localPath, drive.uploadMarkdown.mock.calls[0]![2]);
  });

  it('validates an existing folder instead of creating another', async () => {
    const { drive, local } = fixture('existing');
    await runRoundTrip(drive, local);
    expect(drive.verifyTestFolder).toHaveBeenCalledWith('existing');
    expect(drive.createTestFolder).not.toHaveBeenCalled();
  });

  it('never applies mismatched downloaded content', async () => {
    const { drive, local } = fixture(); drive.download.mockResolvedValue('corrupted');
    await expect(runRoundTrip(drive, local)).rejects.toThrow('did not match');
    expect(local.createNote).not.toHaveBeenCalled();
  });

  it('does not upload if persisting the new folder fails', async () => {
    const { drive, local } = fixture(); local.saveFolder.mockRejectedValue(new Error('disk full'));
    await expect(runRoundTrip(drive, local)).rejects.toThrow('disk full');
    expect(drive.uploadMarkdown).not.toHaveBeenCalled();
  });

  it('does not write locally after an interrupted download', async () => {
    const { drive, local } = fixture(); drive.download.mockRejectedValue(new Error('offline'));
    await expect(runRoundTrip(drive, local)).rejects.toThrow('offline');
    expect(local.createNote).not.toHaveBeenCalled();
  });

  it('checks unload state before touching Drive', async () => {
    const { drive, local } = fixture(); local.ensureActive.mockImplementation(() => { throw new Error('unloaded'); });
    await expect(runRoundTrip(drive, local)).rejects.toThrow('unloaded');
    expect(drive.createTestFolder).not.toHaveBeenCalled();
  });
});
