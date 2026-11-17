import { Notice, Platform, Plugin, requestUrl } from 'obsidian';
import { ResolveModal } from './ui/resolve-modal';
import { ThreadsSettingsTab } from './ui/settings-tab';
import { GoogleAuth, type Credentials } from './auth/google-auth';
import { GoogleHttp } from './drive/http';
import { DriveClient } from './drive/client';
import { safeMessage, ThreadsError } from './shared/errors';
import { loadSettings, parseCredentials, tutorialCredentials, type ThreadsSettings } from './settings/model';
import { runRoundTrip } from './features/roundtrip';
import { MAX_NOTE_BYTES, uploadNoteCopy } from './features/snapshot';
import { effectiveCredentials } from './auth/app-client';
import { SyncDrive, type CloudVault } from './drive/sync-drive';
import { SyncEngine, validNotePath, type SyncState } from './sync/engine';
import { ObsidianSyncLocal } from './sync/local-adapter';

export default class ThreadsPlugin extends Plugin {
  declare settings: ThreadsSettings;
  auth!: GoogleAuth;
  drive!: DriveClient;
  busy = false;
  status = 'Not connected';
  account = '';
  cloudVaults: CloudVault[] = [];
  conflicts: string[] = [];
  private syncDrive!: SyncDrive;
  private timer?: ReturnType<typeof setTimeout>;
  private retryCount = 0;
  private disposed = false;
  private statusEl!: HTMLElement;
  private tab!: ThreadsSettingsTab;

  async onload(): Promise<void> {
    if (!this.app.secretStorage) {
      new Notice('Threads needs Obsidian 1.11.4 or newer with SecretStorage.');
      return;
    }
    this.settings = loadSettings(await this.loadData());
    if (!this.settings.tutorialImported) {
      if (!this.app.secretStorage.getSecret(this.settings.credentialKey)) {
        const previous = tutorialCredentials(this.app.secretStorage.getSecret('threads-google-desktop-client'));
        if (previous) {
          this.app.secretStorage.setSecret(this.settings.credentialKey, JSON.stringify(previous));
          this.status = 'Tutorial credentials imported. Connect Google once to authorize this build.';
        }
      }
      this.settings.tutorialImported = true;
    }
    await this.saveData(this.settings);
    const http = new GoogleHttp(async request => {
      const response = await requestUrl({ ...request, throw: false });
      return { status: response.status, text: response.text };
    });
    this.auth = new GoogleAuth(http, () => this.credentials(), credentials => {
      this.ensureActive();
      this.app.secretStorage.setSecret(this.settings.credentialKey, JSON.stringify(credentials));
    }, async url => {
      if (Platform.isDesktopApp) {
        const { shell } = require('electron') as { shell: { openExternal(url: string): Promise<void> } };
        await shell.openExternal(url);
      } else window.open(url, '_blank', 'noopener,noreferrer');
    }, 180_000, Platform.isDesktopApp, async (url, body) => {
      const response = await requestUrl({ url, body, method: 'POST', contentType: 'application/json', throw: false });
      return { status: response.status, text: response.text };
    });
    this.drive = new DriveClient(http, () => this.auth.accessToken());
    this.syncDrive = new SyncDrive(http, () => this.auth.accessToken(), this.drive, () => this.ensureActive());
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('threads-status');
    this.tab = new ThreadsSettingsTab(this.app, this);
    this.addSettingTab(this.tab);
    try { if (this.credentials().refreshToken) this.status = 'Saved connection (not checked)'; }
    catch (error) { this.status = safeMessage(error); }
    this.renderStatus();
    this.addCommand({ id: 'connect-google', name: 'Connect Google', callback: () => void this.connect() });
    this.addCommand({ id: 'test-drive', name: 'Run Google Drive sample test', callback: () => void this.test() });
    this.addCommand({ id: 'check-google', name: 'Check Google connection', callback: () => void this.checkConnection() });
    this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.syncNow() });
    this.addCommand({ id: 'upload-note-copy', name: 'Upload current note copy', callback: () => void this.uploadCurrentNote() });
    this.addCommand({ id: 'resolve-current-note', name: 'Resolve conflict using current note', callback: () => this.confirmResolution() });
    const changed = (file: { path: string }) => { if (validNotePath(file.path)) this.scheduleSync(1200); };
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('rename', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.app.workspace.onLayoutReady(() => this.scheduleSync(1200));
    this.registerObsidianProtocolHandler('threads-google-return', () => {});
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') this.scheduleSync(1200);
      else clearTimeout(this.timer);
    });
  }

  onunload(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.auth?.reset();
  }

  credentials(): Credentials {
    return effectiveCredentials(parseCredentials(this.app.secretStorage.getSecret(this.settings.credentialKey)));
  }

  ensureActive(): void {
    if (this.disposed) throw new ThreadsError('Threads was unloaded. No further work will be applied.');
  }

  private renderStatus(): void {
    if (this.disposed) return;
    this.statusEl.setText(this.busy ? 'Threads: working' : this.conflicts.length ? `Threads: ${this.conflicts.length} conflicts` :
      this.settings.autoSync ? (this.retryCount ? 'Threads: retrying' : 'Threads: auto sync') : 'Threads: paused');
    this.statusEl.setAttribute('aria-label', this.status);
    this.statusEl.setAttribute('title', this.status);
    this.tab?.refresh();
  }

  async run(label: string, work: () => Promise<string>, silent = false): Promise<boolean> {
    if (this.busy || this.disposed) return false;
    this.busy = true;
    this.status = label;
    this.renderStatus();
    try {
      this.status = await work();
      if (!this.disposed && !silent) new Notice(this.status, 8000);
      return true;
    } catch (error) {
      this.status = safeMessage(error);
      if (!this.disposed && !silent) new Notice(this.status, 10000);
      return false;
    } finally {
      this.busy = false;
      this.renderStatus();
    }
  }

  async saveCredentials(clientId: string, clientSecret: string): Promise<void> {
    await this.run('Saving credentials', async () => {
      clientId = clientId.trim(); clientSecret = clientSecret.trim();
      if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || !clientSecret) {
        throw new ThreadsError('Enter the client ID and client secret from a Google Desktop app OAuth client.');
      }
      this.auth.reset();
      this.settings.autoSync = false;
      clearTimeout(this.timer);
      this.app.secretStorage.setSecret(this.settings.credentialKey, JSON.stringify({ clientId, clientSecret }));
      this.settings.folderId = ''; this.settings.lastTest = ''; this.account = '';
      this.settings.backupFolderId = ''; this.settings.lastUpload = '';
      await this.saveData(this.settings);
      return 'Credentials saved. Connect Google next.';
    });
  }

  async connect(): Promise<void> {
    await this.run('Waiting for Google sign-in in your browser', async () => {
      if (!this.credentials().clientId) throw new ThreadsError('This development build has no Google app configuration. The developer must configure a release, or use Advanced settings.');
      this.settings.autoSync = false;
      clearTimeout(this.timer);
      this.cloudVaults = []; this.conflicts = [];
      // Clear folder identity before switching grants, including on partial sign-in failure.
      this.settings.folderId = ''; this.settings.lastTest = ''; this.account = '';
      this.settings.backupFolderId = ''; this.settings.lastUpload = '';
      await this.saveData(this.settings);
      this.ensureActive();
      this.auth.reset();
      const { clientId, clientSecret, brokerUrl } = this.credentials();
      this.app.secretStorage.setSecret(this.settings.credentialKey, JSON.stringify({ clientId, clientSecret, brokerUrl }));
      await this.auth.connect();
      this.ensureActive();
      this.account = await this.drive.account();
      return `Connected: ${this.account}`;
    });
  }

  async test(): Promise<void> {
    await this.run('Testing Google Drive upload and download', async () => {
      if (!this.credentials().refreshToken) throw new ThreadsError('Connect Google in Threads settings first.');
      const result = await runRoundTrip(this.drive, {
        folderId: this.settings.folderId,
        saveFolder: async id => { this.settings.folderId = id; await this.saveData(this.settings); },
        createNote: async (path, content) => { await this.app.vault.create(path, content); },
        ensureActive: () => this.ensureActive(),
      });
      this.ensureActive();
      this.settings.lastTest = `${new Date().toISOString()} | ${result.localPath} | SHA-256 ${result.sha256}`;
      await this.saveData(this.settings);
      return `Drive test passed. Created ${result.localPath}`;
    });
  }

  async checkConnection(): Promise<void> {
    await this.run('Checking Google connection', async () => {
      const account = await this.drive.account();
      this.ensureActive();
      this.account = account;
      return `Connected: ${account}`;
    });
  }

  async saveFolderName(value: string): Promise<void> {
    await this.run('Saving note-copy folder name', async () => {
      const name = value.trim();
      if (!name || name.length > 150 || /[/\\\x00-\x1f]/.test(name)) throw new ThreadsError('Enter one folder name between 1 and 150 characters, without slashes or control characters.');
      if (name !== this.settings.driveFolderName) {
        this.settings.driveFolderName = name;
        this.settings.backupFolderId = '';
        this.settings.lastUpload = '';
        await this.saveData(this.settings);
      }
      return 'Folder name saved. Existing Drive folders were not renamed or deleted.';
    });
  }

  async uploadCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    await this.run('Uploading a new copy of the current note', async () => {
      if (!this.credentials().refreshToken) throw new ThreadsError('Connect Google in Threads settings first.');
      if (!file || file.extension !== 'md') throw new ThreadsError('Open a Markdown note first.');
      const config = this.app.vault.configDir;
      if (file.path.startsWith(`${config}/`)) throw new ThreadsError('Plugin configuration files cannot be uploaded.');
      if (file.stat.size > MAX_NOTE_BYTES) throw new ThreadsError('This milestone supports Markdown notes up to 1 MiB.');
      const content = await this.app.vault.read(file);
      this.ensureActive();
      const result = await uploadNoteCopy(this.drive, { path: file.path, content }, {
        folderName: this.settings.driveFolderName,
        vaultName: this.app.vault.getName(),
        folderId: this.settings.backupFolderId,
        saveFolder: async id => { this.settings.backupFolderId = id; await this.saveData(this.settings); },
        ensureActive: () => this.ensureActive(),
      });
      this.ensureActive();
      this.settings.lastUpload = `${result.path} | Folder: https://drive.google.com/drive/folders/${result.folderId} | Drive ID ${result.id} | SHA-256 ${result.sha256}`;
      await this.saveData(this.settings);
      return `Uploaded and verified: ${result.path}. This is a copy, not continuous sync.`;
    });
  }

  async resetBackupFolder(): Promise<void> {
    await this.run('Resetting note-copy folder selection', async () => {
      this.settings.backupFolderId = ''; this.settings.lastUpload = '';
      await this.saveData(this.settings);
      return 'Next upload will find or create the configured Threads folder. Existing cloud copies were not deleted.';
    });
  }

  async clearCredentials(): Promise<void> {
    await this.run('Clearing local credentials', async () => {
      this.settings.autoSync = false;
      clearTimeout(this.timer);
      this.cloudVaults = []; this.conflicts = [];
      this.auth.reset();
      this.app.secretStorage.setSecret(this.settings.credentialKey, '');
      this.app.secretStorage.setSecret('threads-google-desktop-client', '');
      this.app.secretStorage.setSecret('threads-google-tokens', '');
      this.settings.folderId = ''; this.settings.lastTest = ''; this.account = '';
      this.settings.backupFolderId = ''; this.settings.lastUpload = '';
      await this.saveData(this.settings);
      return 'Local credentials cleared. Google access is not revoked; manage access in your Google account.';
    });
  }

  async resetFolder(): Promise<void> {
    await this.run('Resetting test folder selection', async () => {
      this.settings.folderId = ''; this.settings.lastTest = '';
      await this.saveData(this.settings);
      return 'Next test will create a new folder. Existing Drive files were not deleted.';
    });
  }

  private scheduleSync(delay = 10_000): void {
    clearTimeout(this.timer);
    if (this.disposed || !this.settings.autoSync || !this.settings.sync || document.visibilityState === 'hidden') return;
    this.timer = setTimeout(() => {
      if (this.busy) this.scheduleSync(1200);
      else void this.syncNow(false);
    }, delay);
  }

  async loadCloudVaults(): Promise<void> {
    await this.run('Loading your cloud vaults', async () => {
      this.cloudVaults = await this.syncDrive.vaults();
      return this.cloudVaults.length ? 'Choose the cloud vault to connect.' : 'No cloud vaults found. Create one to start.';
    });
  }

  async startSync(vaultId?: string): Promise<void> {
    const success = await this.run('Setting up sync', async () => {
      if (!this.credentials().refreshToken) throw new ThreadsError('Sign in with Google first.');
      const accountId = await this.syncDrive.accountId();
      const clientId = this.credentials().clientId;
      let vault: CloudVault | undefined;
      const current = this.settings.sync;
      if (vaultId) vault = (await this.syncDrive.vaults()).find(v => v.id === vaultId);
      else vault = await this.syncDrive.createVault(this.app.vault.getName());
      this.ensureActive();
      if (!vault) throw new ThreadsError('That cloud vault is unavailable to this account.');
      const same = current?.vaultId === vault.id && current.accountId === accountId && current.clientId === clientId;
      if (current && !same) {
        // Preserve the old account-bound checkpoint and any unsent content.
        await this.app.vault.adapter.write(`${this.app.vault.configDir}/plugins/${this.manifest.id}/sync-state-${Date.now()}.json`, JSON.stringify(current));
      }
      const next: SyncState = same ? current : { version: 1, vaultId: vault.id, vaultName: vault.name,
        accountId, clientId, baselines: [] };
      await this.saveData({ ...this.settings, sync: next, autoSync: true });
      this.ensureActive();
      this.settings.sync = next; this.settings.autoSync = true;
      this.conflicts = []; this.retryCount = 0;
      return 'Automatic Markdown sync enabled.';
    });
    if (success) this.scheduleSync(0);
  }

  async setAutoSync(enabled: boolean): Promise<void> {
    await this.run(enabled ? 'Resuming sync' : 'Pausing sync', async () => {
      if (enabled && (!this.settings.sync || !this.credentials().refreshToken)) throw new ThreadsError('Sign in and choose a cloud vault first.');
      await this.saveData({ ...this.settings, autoSync: enabled });
      this.settings.autoSync = enabled;
      this.retryCount = 0;
      this.scheduleSync(enabled ? 0 : 10_000);
      return enabled ? 'Automatic sync enabled.' : 'Sync paused. Local notes and cloud history are unchanged.';
    });
  }

  async syncNow(manual = true, resolvePath?: string): Promise<void> {
    const success = await this.run('Syncing Markdown notes', async () => {
      const state = this.settings.sync;
      if (!state) throw new ThreadsError('Choose a cloud vault in Threads settings first.');
      if (!this.credentials().refreshToken) throw new ThreadsError('Sign in with Google first.');
      if (this.credentials().clientId !== state.clientId || await this.syncDrive.accountId() !== state.accountId) {
        throw new ThreadsError('This sync selection belongs to another Google account or app. Select a cloud vault for the current account.');
      }
      this.ensureActive();
      const local = new ObsidianSyncLocal(this.app.vault, async next => {
        this.ensureActive();
        await this.saveData({ ...this.settings, sync: next });
        this.settings.sync = next;
      }, () => this.ensureActive());
      const result = await new SyncEngine(state, this.syncDrive, local).run(resolvePath);
      this.conflicts = result.conflicts;
      return `Synced: ${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.conflicts.length} conflicts, ${result.skipped} skipped.`;
    }, !manual);
    this.retryCount = success ? 0 : Math.min(this.retryCount + 1, 6);
    this.renderStatus();
    this.scheduleSync(success ? 10_000 : Math.min(300_000, 5000 * 2 ** this.retryCount));
  }

  confirmResolution(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file || !validNotePath(file.path) || !this.conflicts.includes(file.path)) {
      new Notice('Sync first, then open an original note listed as conflicting.'); return;
    }
    new ResolveModal(this.app, file.path, () => void this.syncNow(true, file.path)).open();
  }
}
