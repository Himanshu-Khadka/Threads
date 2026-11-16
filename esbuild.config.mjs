import * as esbuild from 'esbuild';

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  external: ['obsidian', 'electron'],
  sourcemap: false,
  logLevel: 'info',
});
if (process.argv.includes('--watch')) await context.watch();
else {
  await context.rebuild();
  await context.dispose();
}
