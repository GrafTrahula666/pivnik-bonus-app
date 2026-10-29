#!/usr/bin/env node
// Run locally with the owner's authenticated GitHub CLI. Never prints secrets.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repository = 'GrafTrahula666/pivnik-bonus-app';
const expectedCertificate = '36D73F80FB10E8EE2D2E7D1765AECFF5809405D202D700C609366C084F7F2663';
const parameters = process.argv.slice(2);
const options = new Map();
let checkOnly = false;
for (let index = 0; index < parameters.length; index += 1) {
  const name = parameters[index];
  if (name === '--check-only') { checkOnly = true; continue; }
  if (!['--keystore', '--credentials'].includes(name) || options.has(name)
    || !parameters[index + 1] || parameters[index + 1].startsWith('--')) {
    console.error('Usage: node scripts/configure-evotor-signing-secrets.mjs --keystore FILE --credentials JSON [--check-only]');
    process.exit(1);
  }
  options.set(name, parameters[++index]);
}

try {
  if (!options.has('--keystore') || !options.has('--credentials')) throw new Error('Both private file paths are required.');
  const keystore = fs.readFileSync(options.get('--keystore'));
  const credentials = JSON.parse(fs.readFileSync(options.get('--credentials'), 'utf8'));
  for (const name of ['EVOTOR_KEYSTORE_PASSWORD', 'EVOTOR_KEY_PASSWORD', 'EVOTOR_KEY_ALIAS']) {
    if (typeof credentials[name] !== 'string' || !credentials[name] || /[\r\n\0]/.test(credentials[name])) {
      throw new Error('The private credential file is incomplete.');
    }
  }
  const result = spawnSync('keytool', [
    '-exportcert', '-keystore', options.get('--keystore'), '-alias', credentials.EVOTOR_KEY_ALIAS,
    '-storepass:env', 'EVOTOR_CERTIFICATE_CHECK_PASSWORD',
  ], { env: { ...process.env, EVOTOR_CERTIFICATE_CHECK_PASSWORD: credentials.EVOTOR_KEYSTORE_PASSWORD }, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Cannot open the private keystore with the supplied credentials.');
  const certificate = new crypto.X509Certificate(result.stdout);
  if (certificate.fingerprint256.replaceAll(':', '').toUpperCase() !== expectedCertificate) {
    throw new Error('Certificate differs from the approved permanent Evotor certificate.');
  }
  if (checkOnly) {
    console.log('Permanent certificate verified. No GitHub secrets changed.');
    process.exit(0);
  }
  const auth = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], { stdio: 'pipe' });
  if (auth.error || auth.status !== 0) throw new Error('Authenticate the GitHub CLI as the repository owner first.');
  const secrets = { ...credentials, EVOTOR_KEYSTORE_B64: keystore.toString('base64') };
  const names = ['EVOTOR_KEYSTORE_B64', 'EVOTOR_KEYSTORE_PASSWORD', 'EVOTOR_KEY_ALIAS', 'EVOTOR_KEY_PASSWORD'];
  for (const name of names) {
    const write = spawnSync('gh', ['secret', 'set', name, '--repo', repository], {
      input: secrets[name], encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (write.error || write.status !== 0) throw new Error(`Failed to set ${name}; retry with the same backup files.`);
  }
  const listing = spawnSync('gh', ['secret', 'list', '--repo', repository, '--json', 'name'], { encoding: 'utf8' });
  if (listing.error || listing.status !== 0) throw new Error('Secrets were submitted, but the names could not be verified.');
  const present = new Set(JSON.parse(listing.stdout).map(entry => entry.name));
  if (!names.every(name => present.has(name))) throw new Error('Signing secret provisioning is incomplete; retry with the same files.');
  console.log('Four permanent signing secrets configured; no new key was generated.');
} catch (error) {
  // Parser, keytool and gh errors may include sensitive input; only emit fixed messages.
  const safe = new Set([
    'Both private file paths are required.', 'The private credential file is incomplete.',
    'Cannot open the private keystore with the supplied credentials.',
    'Certificate differs from the approved permanent Evotor certificate.',
    'Authenticate the GitHub CLI as the repository owner first.',
    'Secrets were submitted, but the names could not be verified.',
    'Signing secret provisioning is incomplete; retry with the same files.',
    ...['EVOTOR_KEYSTORE_B64', 'EVOTOR_KEYSTORE_PASSWORD', 'EVOTOR_KEY_ALIAS', 'EVOTOR_KEY_PASSWORD']
      .map(name => `Failed to set ${name}; retry with the same backup files.`),
  ]);
  console.error(safe.has(error?.message) ? error.message : 'Signing setup failed; verify the two private files and required tools.');
  process.exitCode = 1;
}
