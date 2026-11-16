import { Notice, Plugin } from "obsidian";
import { ThreadsSettingsTab } from "./settings";
import { readGoogleClient } from "./credentials";
import { waitForGoogleCode } from "./callback";
import { exchangeGoogleCode } from "./tokens";


export default class ThreadsPlugin extends Plugin {
  driveFolderName = "Threads";
  private googleLogin: AbortController | null = null;
  async onload() {
    
    const saved = await this.loadData();

    if (typeof saved?.driveFolderName === "string") {
        this.driveFolderName = saved.driveFolderName;
    }

    new Notice("Threads is running!");

    this.addSettingTab(new ThreadsSettingsTab(this.app, this));

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => {
        new Notice("Threads: sync requested.");
      }
    });
  }

    async testGoogleSignIn() {
    if (this.googleLogin) {
        new Notice("A sign-in attempt is already running.");
        return;
    }

    const credentials = readGoogleClient(this.app);
    if (!credentials) {
        new Notice("Save your Google credentials in Threads settings first.");
        return;
    }

    const controller = new AbortController();
    this.googleLogin = controller;

    try {
        const { shell } = require("electron") as {
        shell: { openExternal(url: string): Promise<void> };
        };

        new Notice("Complete Google sign-in in your browser.");

        await waitForGoogleCode(
        credentials.clientId,
        url => shell.openExternal(url),
        controller.signal
        );

        if (!controller.signal.aborted) {
        new Notice("Google response verified! Drive connection is not finished yet.");
        }
    } catch (error) {
        if (!controller.signal.aborted) {
        new Notice(error instanceof Error ? error.message : "Sign-in failed.");
        }
    } finally {
        this.googleLogin = null;
    }
    }

  onunload() {
    console.log("Threads stopped.");
    this.googleLogin?.abort();
  }
}