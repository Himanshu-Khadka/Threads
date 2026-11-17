import { fileURLToPath } from 'node:url';
import { readMetadata, validateHostedConfig, validateMetadata } from './release-utils.mjs';

const version = validateMetadata(await readMetadata(fileURLToPath(new URL('../', import.meta.url))));
validateHostedConfig(process.env);
console.log(`Hosted release configuration checked: ${version}`);
