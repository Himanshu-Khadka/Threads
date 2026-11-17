import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import { GoogleAuth, type Credentials } from './oauth';
import { GoogleHttp } from './http';
import { DriveClient } from './drive';
import { safeMessage, ThreadsError } from './errors';
import { loadSettings, parseCredentials, tutorialCredentials, type ThreadsSettings } from './settings';
import { runRoundTrip } from './roundtrip';
import { MAX_NOTE_BYTES, uploadNoteCopy } from './snapshot';
import { bundledClient, effectiveCredentials } from './app-client';
import { SyncDrive, type CloudVault } from './sync-drive';
import { SyncEngine, validNotePath, type SyncState } from './sync';
import { ObsidianSyncLocal } from './sync-local';

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
      const { shell } = require('electron') as { shell: { openExternal(url: string): Promise<void> } };
      await shell.openExternal(url);
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
      const { clientId, clientSecret } = this.credentials();
      this.app.secretStorage.setSecret(this.settings.credentialKey, JSON.stringify({ clientId, clientSecret }));
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
    if (this.disposed || !this.settings.autoSync || !this.settings.sync) return;
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

class ResolveModal extends Modal {
  constructor(app: App, private path: string, private confirm: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Use this note to resolve conflicts?');
    this.contentEl.createEl('p', { text: `The saved text of ${this.path} will become the new version of all cloud revisions found at the start of this sync. Previous revisions and conflict copies are retained.` });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Use current note').setCta().onClick(() => { this.close(); this.confirm(); }));
  }
}

class ThreadsSettingsTab extends PluginSettingTab {
  private visible = false;
  private advanced = false;
  private selectedVault = '';
  private clientId = '';
  private clientSecret = '';
  private folderName: string | undefined;

  constructor(app: App, private plugin: ThreadsPlugin) { super(app, plugin); }

  hide(): void { this.visible = false; this.clientSecret = ''; this.clientId = ''; this.folderName = undefined; }
  refresh(): void { if (this.visible) this.display(); }

  display(): void {
    this.visible = true;
    const { containerEl: container, plugin } = this;
    container.empty();
    new Setting(container).setName('Threads').setDesc('Desktop Markdown sync preview').setHeading();
    new Setting(container).setName('Status').setDesc(plugin.status);
    let credentials: Credentials = { clientId: '', clientSecret: '' };
    try { credentials = plugin.credentials(); } catch { /* Keep recovery controls available. */ }
    const connected = !!credentials.refreshToken;
    new Setting(container).setName('Google Drive')
      .setDesc(connected ? plugin.account || 'Connected to Google. Files stay in your own Drive.' : 'Sign in to store and sync notes in your own Google Drive.')
      .addButton(button => button.setButtonText(connected ? 'Switch account' : 'Sign in with Google').setCta().setDisabled(plugin.busy)
        .onClick(() => void plugin.connect()));
    if (!credentials.clientId && !bundledClient) new Setting(container).setName('Developer build')
      .setDesc('Public sign-in is not configured in this build. The publisher must add the Google Desktop app configuration. Personal setup is available under Advanced.');
    if (connected) {
      new Setting(container).setName('Cloud vault')
        .setDesc(plugin.settings.sync ? `${plugin.settings.sync.vaultName} | ${plugin.settings.sync.vaultId}` : 'Create a cloud vault, or select the same one on your other computer.')
        .addButton(button => button.setButtonText('Create cloud vault').setDisabled(plugin.busy).onClick(() => void plugin.startSync()))
        .addButton(button => button.setButtonText('Find existing vaults').setDisabled(plugin.busy).onClick(() => void plugin.loadCloudVaults()));
      if (plugin.cloudVaults.length) {
        if (!plugin.cloudVaults.some(v => v.id === this.selectedVault)) this.selectedVault = plugin.cloudVaults[0]!.id;
        new Setting(container).setName('Existing cloud vault')
          .addDropdown(dropdown => {
            for (const vault of plugin.cloudVaults) dropdown.addOption(vault.id, `${vault.name} (${vault.id.slice(-8)})`);
            dropdown.setValue(this.selectedVault).setDisabled(plugin.busy).onChange(value => { this.selectedVault = value; });
          })
          .addButton(button => button.setButtonText('Start syncing').setDisabled(plugin.busy).onClick(() => void plugin.startSync(this.selectedVault)));
      }
      new Setting(container).setName('Sync scope')
        .setDesc('Starting sync uploads supported Markdown notes from this vault and downloads cloud notes. Attachments and settings are excluded. Deletions are not propagated. Keep a separate backup.');
      if (plugin.settings.sync) {
        new Setting(container).setName('Automatic sync').setDesc('Runs while desktop Obsidian is open. Offline changes retry when the connection returns.')
          .addToggle(toggle => toggle.setValue(plugin.settings.autoSync).setDisabled(plugin.busy).onChange(value => void plugin.setAutoSync(value)))
          .addButton(button => button.setButtonText('Sync now').setDisabled(plugin.busy).onClick(() => void plugin.syncNow()));
      }
      if (plugin.conflicts.length) new Setting(container).setName(`${plugin.conflicts.length} notes need attention`)
        .setDesc(`Cloud versions are saved under _Threads conflicts. Original notes are kept. ${plugin.conflicts.slice(0, 5).join(', ')}`)
        .addButton(button => button.setButtonText('Resolve current note').setDisabled(plugin.busy).onClick(() => plugin.confirmResolution()));
      new Setting(container).setName('Account')
        .addButton(button => button.setButtonText('Disconnect').setDisabled(plugin.busy).onClick(() => void plugin.clearCredentials()));
    }
    new Setting(container).setName('Advanced')
      .addButton(button => button.setButtonText(this.advanced ? 'Hide' : 'Show').onClick(() => { this.advanced = !this.advanced; this.display(); }));
    if (!this.advanced) return;
    new Setting(container).setName('Personal OAuth and diagnostics').setHeading();
    new Setting(container).setName('Desktop OAuth client ID')
      .addText(text => text.setValue(this.clientId || credentials.clientId).setDisabled(plugin.busy)
        .setPlaceholder('...apps.googleusercontent.com').onChange(value => { this.clientId = value; }));
    new Setting(container).setName('Desktop OAuth client secret')
      .setDesc(credentials.clientSecret ? 'Saved. Enter only to replace credentials.' : 'From your own Google Cloud project.')
      .addText(text => {
        text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off';
        text.setValue(this.clientSecret).setDisabled(plugin.busy).onChange(value => { this.clientSecret = value; });
      });
    new Setting(container).setName('OAuth credentials').setDesc('Saving replaces the local grant; reconnect afterward.')
      .addButton(button => button.setButtonText('Save credentials').setDisabled(plugin.busy).onClick(async () => {
        const id = this.clientId || credentials.clientId;
        const secret = this.clientSecret || (id === credentials.clientId ? credentials.clientSecret : '');
        this.clientSecret = '';
        await plugin.saveCredentials(id, secret);
      }));
    new Setting(container).setName('Google account')
      .addButton(button => button.setButtonText('Connect Google').setCta().setDisabled(plugin.busy || !credentials.clientId)
        .onClick(() => void plugin.connect()))
      .addButton(button => button.setButtonText('Check connection').setDisabled(plugin.busy || !credentials.refreshToken)
        .onClick(() => void plugin.checkConnection()));
    new Setting(container).setName('Note-copy folder')
      .setDesc('Drive root folder. Notes go inside this folder, then your vault name and matching note subfolders. Existing Threads-created folders are reused.')
      .addText(text => text.setValue(this.folderName ?? plugin.settings.driveFolderName).setDisabled(plugin.busy)
        .onChange(value => { this.folderName = value; }))
      .addButton(button => button.setButtonText('Save folder').setDisabled(plugin.busy)
        .onClick(() => void plugin.saveFolderName(this.folderName ?? plugin.settings.driveFolderName)));
    new Setting(container).setName('Current note')
      .setDesc('Uploads the saved Markdown text as a new copy, then verifies it by downloading. Does not include attachments or modify your original note.')
      .addButton(button => button.setButtonText('Upload current note copy').setDisabled(plugin.busy || !credentials.refreshToken)
        .onClick(() => void plugin.uploadCurrentNote()));
    if (plugin.settings.lastUpload) new Setting(container).setName('Last verified note upload')
      .setDesc(plugin.settings.lastUpload).setClass('threads-result');
    new Setting(container).setName('Connection test')
      .setDesc('Creates a sample Markdown file in Drive, downloads it, and adds a verified copy to this vault. Existing notes are never uploaded or overwritten.')
      .addButton(button => button.setButtonText('Run sample test').setDisabled(plugin.busy || !credentials.refreshToken)
        .onClick(() => void plugin.test()));
    if (plugin.settings.lastTest) new Setting(container).setName('Last successful test').setDesc(plugin.settings.lastTest).setClass('threads-result');
    new Setting(container).setName('Test folder').setDesc('Reset only forgets the folder selection. No remote files are removed.')
      .addButton(button => button.setButtonText('Reset folder').setDisabled(plugin.busy || !plugin.settings.folderId)
        .onClick(() => void plugin.resetFolder()));
    new Setting(container).setName('Note-copy folder selection').setDesc('Forget a deleted or inaccessible folder without deleting any cloud files.')
      .addButton(button => button.setButtonText('Reset note folder').setDisabled(plugin.busy || !plugin.settings.backupFolderId)
        .onClick(() => void plugin.resetBackupFolder()));
    new Setting(container).setName('Local credentials').setDesc('Clears this installation only. Revoke Google access separately at myaccount.google.com/permissions.')
      .addButton(button => button.setButtonText('Clear credentials').setDisabled(plugin.busy)
        .onClick(() => void plugin.clearCredentials()));
  }
}
