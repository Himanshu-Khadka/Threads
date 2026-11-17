import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ThreadsPlugin from "./main";
import { readGoogleClient, saveGoogleClient } from "./credentials";

export class ThreadsSettingsTab extends PluginSettingTab {
  constructor(app: App, private threads: ThreadsPlugin) {
    super(app, threads);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    let folderName = this.threads.driveFolderName;

    const savedClient = readGoogleClient(this.app);
    let clientId = savedClient?.clientId ?? "";
    let clientSecret = "";

    new Setting(containerEl)
        .setName("Google Client ID")
        .addText(text => text
            .setValue(clientId)
            .setPlaceholder("...apps.googleusercontent.com")
            .onChange(value => { clientId = value; }));

    new Setting(containerEl)
        .setName("Google Client secret")
        .setDesc("Enter both credentials when saving or replacing them.")
            .addText(text => {
                text.inputEl.type = "password";
                text.inputEl.autocomplete = "off";
                text.onChange(value => { clientSecret = value; });
    });

    new Setting(containerEl)
        .setName("Google credentials")
        .setDesc(savedClient ? "Credentials stored. Not connected yet." : "No credentials stored.")
        .addButton(button => button
            .setButtonText("Save credentials")
            .onClick(() => {
                if (!clientId.trim() || !clientSecret.trim()) {
                    new Notice("Enter both the Client ID and Client secret.");
                    return;
                }

        try {
            saveGoogleClient(this.app, clientId, clientSecret);
            const check = readGoogleClient(this.app);

        if (
          check?.clientId !== clientId.trim() ||
          check?.clientSecret !== clientSecret.trim()
        ) {
          throw new Error("Credential storage verification failed.");
        }

        clientSecret = "";
        this.display();
        new Notice("Google credentials saved and verified.");
      } catch {
        new Notice("Could not save credentials. Check your Obsidian version.");
      }                                                       
    }));

    new Setting(containerEl)
      .setName("Google Drive folder")
      .setDesc("The folder name we will use when Drive is connected.")
      .addText(text => text
        .setValue(folderName)
        .onChange(value => { folderName = value; }))
      .addButton(button => button
        .setButtonText("Save")
        .onClick(async () => {
          const name = folderName.trim();
          if (!name) {
            new Notice("Enter a folder name.");
            return;
          }

          button.setDisabled(true);
          try {
            await this.threads.saveData({ driveFolderName: name });
            this.threads.driveFolderName = name;
            new Notice("Folder name saved.");
          } catch {
            new Notice("Could not save the folder name.");
          } finally {
            button.setDisabled(false);
          }
        }));

        new Setting(containerEl)
            .setName("Google sign-in")
            .addButton(button => button
                .setButtonText("Test Google sign-in")
                .onClick(() => this.threads.testGoogleSignIn()));

  }
}