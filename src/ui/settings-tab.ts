import { App, Platform, PluginSettingTab, Setting } from 'obsidian';
import type ThreadsPlugin from '../plugin';
import type { Credentials } from '../auth/google-auth';
import { bundledClient } from '../auth/app-client';

export class ThreadsSettingsTab extends PluginSettingTab {
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
    new Setting(container).setName('Threads').setDesc('Cross-platform Markdown sync preview').setHeading();
    new Setting(container).setName('Status').setDesc(plugin.status);
    let credentials: Credentials = { clientId: '', clientSecret: '' };
    try { credentials = plugin.credentials(); } catch { /* Keep recovery controls available. */ }
    const connected = !!credentials.refreshToken;
    new Setting(container).setName('Google Drive')
      .setDesc(connected ? plugin.account || 'Connected to Google. Files stay in your own Drive.' : 'Sign in to store and sync notes in your own Google Drive.')
      .addButton(button => button.setButtonText(connected ? 'Switch account' : 'Sign in with Google').setCta().setDisabled(plugin.busy)
        .onClick(() => void plugin.connect()));
    if (!credentials.clientId && !bundledClient) new Setting(container).setName('Developer build')
      .setDesc('Public sign-in is not configured. The publisher must configure a hosted-auth release for mobile, or a Desktop client for desktop-only use.');
    if (connected) {
      new Setting(container).setName('Cloud vault')
        .setDesc(plugin.settings.sync ? `${plugin.settings.sync.vaultName} | ${plugin.settings.sync.vaultId}` : 'Create a cloud vault, or select the same one on your other device.')
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
        new Setting(container).setName('Automatic sync').setDesc('Runs while Obsidian is active. Mobile operating systems can suspend background sync.')
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
    if (Platform.isDesktopApp) {
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
    }
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
