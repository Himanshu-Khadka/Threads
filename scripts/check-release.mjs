import { readFile } from 'node:fs/promises';

const json = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
const manifest = await json('manifest.json');
const pkg = await json('package.json');
const lock = await json('package-lock.json');
const versions = await json('versions.json');
if (!process.env.THREADS_AUTH_ORIGIN || !process.env.THREADS_GOOGLE_WEB_CLIENT_ID) {
  throw Error('Configure the public hosted-auth Actions variables before releasing.');
}
if (process.env.GITHUB_REF_NAME !== manifest.version || pkg.version !== manifest.version ||
  lock.version !== manifest.version || lock.packages[''].version !== manifest.version ||
  versions[manifest.version] !== manifest.minAppVersion) {
  throw Error('Tag, manifest, package, lockfile, and versions.json must agree.');
}
console.log(`Release metadata checked: ${manifest.version}`);
