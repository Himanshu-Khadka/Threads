import * as esbuild from "esbuild";

await esbuild.build({
    entryPoints: ["main.ts"],
    bundle: true,
    outfile: "main.js",
    format: "cjs",
    platform: "node",
    target: "es2022",
    external: ["obsidian"],
    logLevel:"info"
});