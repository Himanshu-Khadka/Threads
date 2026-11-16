import { mkdir, copyFile, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const destination = `dist/${manifest.id}`;
await mkdir(destination, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(file, `${destination}/${file}`);
}
console.log(`Installable plugin: ${destination}`);
