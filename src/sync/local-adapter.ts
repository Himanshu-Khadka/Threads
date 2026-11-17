import { TFile, TFolder, type Vault } from 'obsidian';
import { ThreadsError } from '../shared/errors';
import { CONFLICT_DIR, digest, validNotePath, type SyncLocal, type SyncState } from './engine';

export class ObsidianSyncLocal implements SyncLocal {
  constructor(private vault: Vault, public save: (state: SyncState) => Promise<void>, public ensureActive: () => void) {}

  private allowed(path: string): void {
    const config = this.vault.configDir.toLowerCase();
    if (!validNotePath(path) || path.toLowerCase() === config || path.toLowerCase().startsWith(`${config}/`)) {
      throw new ThreadsError('Blocked a sync path outside the supported note folders.');
    }
  }

  paths(): string[] {
    const config = `${this.vault.configDir.toLowerCase()}/`;
    return this.vault.getMarkdownFiles().map(file => file.path)
      .filter(path => !path.toLowerCase().startsWith(config) && !path.toLowerCase().startsWith(`${CONFLICT_DIR.toLowerCase()}/`));
  }

  async read(path: string): Promise<string | null> {
    this.ensureActive(); this.allowed(path);
    const file = this.vault.getAbstractFileByPath(path);
    if (file === null) return null;
    if (!(file instanceof TFile)) throw new ThreadsError('A folder occupies a note path. Sync stopped.');
    return this.vault.read(file);
  }

  private async preparePath(path: string): Promise<void> {
    const parts = path.split('/');
    // Reject aliases and file/folder collisions before creating or replacing.
    const loaded = new Map(this.vault.getAllLoadedFiles().map(file => [file.path.normalize('NFC').toLowerCase(), file.path]));
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      const existing = loaded.get(prefix.normalize('NFC').toLowerCase());
      if (existing !== undefined && existing !== prefix) throw new ThreadsError('A case-equivalent file or folder already exists. Rename it before syncing.');
    }
    for (let i = 1; i < parts.length; i++) {
      this.ensureActive();
      const dir = parts.slice(0, i).join('/');
      const existing = this.vault.getAbstractFileByPath(dir);
      if (existing && !(existing instanceof TFolder)) throw new ThreadsError('A file occupies a required sync folder.');
      if (!existing) await this.vault.createFolder(dir);
    }
  }

  async replaceIfUnchanged(path: string, expected: string | null, content: string): Promise<boolean> {
    this.ensureActive(); this.allowed(path);
    await this.preparePath(path);
    this.ensureActive();
    const file = this.vault.getAbstractFileByPath(path);
    if (expected === null) {
      if (file) return false;
      // Vault.create fails if a file appears concurrently; it never overwrites.
      await this.vault.create(path, content);
      return true;
    }
    if (!(file instanceof TFile)) return false;
    let replaced = false;
    await this.vault.process(file, current => {
      this.ensureActive();
      if (current !== expected) return current;
      replaced = true;
      return content;
    });
    return replaced;
  }

  async conflict(path: string, revisionId: string, content: string): Promise<void> {
    this.ensureActive(); this.allowed(path);
    const name = path.split('/').pop()!.slice(0, -3).slice(0, 60);
    const target = `${CONFLICT_DIR}/${name} - ${digest(`${path}\0${revisionId}`)}.md`;
    await this.preparePath(target);
    this.ensureActive();
    const file = this.vault.getAbstractFileByPath(target);
    if (file instanceof TFile && await this.vault.read(file) === content) return;
    if (file) throw new ThreadsError('A conflict copy was edited. Keep its changes elsewhere, or resolve the original note before syncing.');
    await this.vault.create(target, content);
  }
}
