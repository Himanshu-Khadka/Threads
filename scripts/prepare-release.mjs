import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { metadataFiles, nextVersion, readMetadata, validateMetadata } from './release-utils.mjs';

export async function prepareRelease(root, requested) {
  const data = await readMetadata(root);
  const previous = validateMetadata(data);
  const next = nextVersion(previous, requested);
  data.pkg.version = data.lock.version = data.lock.packages[''].version = data.manifest.version = next;
  data.versions[next] = data.manifest.minAppVersion;
  validateMetadata(data);
  const values = [data.pkg, data.lock, data.manifest, data.versions];
  for (let i = 0; i < metadataFiles.length; i++) await writeFile(path.join(root, metadataFiles[i]), JSON.stringify(values[i], null, 2) + '\n');
  return next;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw Error('Usage: npm run release:prepare -- patch|minor|major|x.y.z');
  const next = await prepareRelease(fileURLToPath(new URL('../', import.meta.url)), process.argv[2]);
  console.log(`Prepared ${next}. Update CHANGELOG.md, run npm run test:all, then commit and merge into main. No commit, tag, or release was created.`);
}
