import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMetadata, releaseAssetNames, validateHostedConfig, validateMetadata } from './release-utils.mjs';
import { GitHubReleaseClient, planRelease, publishRelease, sha256 } from './github-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = await readMetadata(root);
const version = validateMetadata(metadata);
const mode = process.argv[2];
if (!['plan', 'publish'].includes(mode)) throw Error('Usage: node scripts/release.mjs plan|publish');
if (process.env.GITHUB_REF !== 'refs/heads/main') throw Error('Automated publication is restricted to main.');
const client = new GitHubReleaseClient(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN);
const sha = process.env.GITHUB_SHA;
const plan = await planRelease(client, version, sha);
if (plan.publish) validateHostedConfig(process.env);
if (mode === 'plan') {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=${plan.publish}\nversion=${version}\n`);
  console.log(plan.publish ? `Ready to test and build ${version}.` : plan.reason);
} else if (!plan.publish) console.log(plan.reason);
else {
  const folder = path.join(root, 'dist', 'releases', version);
  const assets = await Promise.all(releaseAssetNames(metadata.manifest).map(async name => ({ name, bytes: await readFile(path.join(folder, name)) })));
  const packedManifest = JSON.parse(assets.find(a => a.name === 'manifest.json').bytes.toString());
  if (JSON.stringify(packedManifest) !== JSON.stringify(metadata.manifest)) throw Error('Packaged manifest differs from source. Rebuild.');
  const sums = assets.filter(a => a.name !== 'SHA256SUMS').map(a => `${sha256(a.bytes)}  ${a.name}\n`).join('');
  if (assets.find(a => a.name === 'SHA256SUMS').bytes.toString() !== sums) throw Error('Local release checksums differ. Rebuild.');
  console.log(await publishRelease(client, { version, sha, assets }));
}
