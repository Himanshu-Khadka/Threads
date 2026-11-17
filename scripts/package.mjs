import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const destination = `dist/${manifest.id}`;
await mkdir(destination, { recursive: true });
const archive = {};
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(file, `${destination}/${file}`);
  archive[`${manifest.id}/${file}`] = new Uint8Array(await readFile(file));
}
await writeFile(`dist/${manifest.id}-${manifest.version}.zip`, zipSync(archive));
console.log(`Installable plugin: ${destination}`);
