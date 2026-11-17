import { App, Modal, Setting } from 'obsidian';

export class ResolveModal extends Modal {
  constructor(app: App, private path: string, private confirm: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Use this note to resolve conflicts?');
    this.contentEl.createEl('p', { text: `The saved text of ${this.path} will become the new version of all cloud revisions found at the start of this sync. Previous revisions and conflict copies are retained.` });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Use current note').setCta().onClick(() => { this.close(); this.confirm(); }));
  }
}
