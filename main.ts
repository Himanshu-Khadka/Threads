import { Notice, Plugin } from "obsidian";

export default class ThreadsPlugin extends Plugin {
  onload() {
    new Notice("Threads is running!");

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => {
        new Notice("Threads: sync requested.");
      }
    });
  }

  onunload() {
    console.log("Threads stopped.");
  }
}