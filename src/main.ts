import { App, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import { GoogleAuth, type Credentials } from './oauth';
import { GoogleHttp } from './http';
import { DriveClient } from './drive';
import { safeMessage, ThreadsError } from './errors';
import { loadSettings, parseCredentials, tutorialCredentials, type ThreadsSettings } from './settings';
import { runRoundTrip } from './roundtrip';
import { MAX_NOTE_BYTES, uploadNoteCopy } from './snapshot';

export default class ThreadsPlugin extends Plugin {
  declare settings: ThreadsSettings;
  auth!: GoogleAuth;
  drive!: DriveClient;
  busy = false;
  status = 'Not connected';
  account = '';
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
    this.addCommand({ id: 'sync-now', name: 'Upload current note copy', callback: () => void this.uploadCurrentNote() });
  }

  onunload(): void {
    this.disposed = true;
    this.auth?.reset();
  }

  credentials(): Credentials {
    return parseCredentials(this.app.secretStorage.getSecret(this.settings.credentialKey));
  }

  ensureActive(): void {
    if (this.disposed) throw new ThreadsError('Threads was unloaded. No further work will be applied.');
  }

  private renderStatus(): void {
    if (this.disposed) return;
    this.statusEl.setText(this.busy ? 'Threads: working' : 'Threads: idle');
    this.statusEl.setAttribute('aria-label', this.status);
    this.statusEl.setAttribute('title', this.status);
    this.tab?.refresh();
  }

  async run(label: string, work: () => Promise<string>): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.status = label;
    this.renderStatus();
    try {
      this.status = await work();
      if (!this.disposed) new Notice(this.status, 8000);
    } catch (error) {
      this.status = safeMessage(error);
      if (!this.disposed) new Notice(this.status, 10000);
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
      this.app.secretStorage.setSecret(this.settings.credentialKey, JSON.stringify({ clientId, clientSecret }));
      this.settings.folderId = ''; this.settings.lastTest = ''; this.account = '';
      this.settings.backupFolderId = ''; this.settings.lastUpload = '';
      await this.saveData(this.settings);
      return 'Credentials saved. Connect Google next.';
    });
  }

  async connect(): Promise<void> {
    await this.run('Waiting for Google sign-in in your browser', async () => {
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
}

class ThreadsSettingsTab extends PluginSettingTab {
  private visible = false;
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
    new Setting(container).setName('Threads').setDesc('Desktop milestone 0.2.0. Manual note copies and transfer tests. Automatic sync is not implemented.').setHeading();
    new Setting(container).setName('Status').setDesc(plugin.status);
    let credentials: Credentials = { clientId: '', clientSecret: '' };
    try { credentials = plugin.credentials(); } catch { /* Keep recovery controls available. */ }
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
