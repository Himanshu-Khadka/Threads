import { Notice, Plugin } from "obsidian";

export default class ThreadsPlugin extends Plugin{
    onload(){
        new Notice("Thread is running!")
    }

    onunload() {
        console.log("Threads stopped.")
    }
}