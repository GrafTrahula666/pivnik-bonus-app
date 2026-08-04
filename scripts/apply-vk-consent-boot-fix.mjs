import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vkPlatformPath = path.join(root, 'vk-platform.js');
const universalServerPath = path.join(root, 'universal-server.js');
const loaderCssPath = path.join(root, 'loader-fix.css');

const marker = 'VK consent gate idempotency hotfix';
const cacheVersion = '3.2.1-consent-gate';

const originalGate = `  function openConsentGate() {
    if (!consentRequired) return;
    const modal = document.getElementById('consentModal');
    const shell = document.getElementById('appShell');
    if (!modal || shell?.classList.contains('hidden')) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }`;

const fixedGate = `  function openConsentGate() {
    if (!consentRequired) return;
    const modal = document.getElementById('consentModal');
    const shell = document.getElementById('appShell');
    if (!modal || shell?.classList.contains('hidden')) return;

    // ${marker}. MutationObserver watches these exact attributes, so writing
    // the same values repeatedly can create an endless microtask loop in VK iOS.
    const alreadyOpen = modal.classList.contains('open')
      && modal.getAttribute('aria-hidden') === 'false'
      && document.body.classList.contains('modal-open');
    if (!alreadyOpen) {
      modal.classList.add('open');
      if (modal.getAttribute('aria-hidden') !== 'false') {
        modal.setAttribute('aria-hidden', 'false');
      }
      document.body.classList.add('modal-open');
    }

    // The app-level consent guard continues to protect every action. The
    // observer is only needed to open the first gate and must not observe its
    // own mutations indefinitely.
    consentObserver?.disconnect();
    consentObserver = null;
  }`;

async function patchVkPlatform() {
  let source = await fs.readFile(vkPlatformPath, 'utf8');
  if (!source.includes(marker)) {
    if (!source.includes(originalGate)) {
      throw new Error('VK consent gate source changed; hotfix target was not found.');
    }
    source = source.replace(originalGate, fixedGate);
    await fs.writeFile(vkPlatformPath, source);
  }
}

async function bumpVkPlatformCacheVersion() {
  let source = await fs.readFile(universalServerPath, 'utf8');
  const versionPattern = /vk-platform\.js\?v=[^"\\]+/g;
  const next = source.replace(versionPattern, `vk-platform.js?v=${cacheVersion}`);
  if (next === source && !source.includes(`vk-platform.js?v=${cacheVersion}`)) {
    throw new Error('VK platform cache-version reference was not found.');
  }
  if (next !== source) await fs.writeFile(universalServerPath, next);
}

async function hardenLoaderVisibility() {
  let source = await fs.readFile(loaderCssPath, 'utf8');
  const block = `.boot-screen.hidden {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}`;
  const replacement = `.boot-screen.hidden {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}`;
  if (!source.includes('display: none !important;')) {
    if (!source.includes(block)) {
      throw new Error('Loading-screen hidden-state block was not found.');
    }
    source = source.replace(block, replacement);
    await fs.writeFile(loaderCssPath, source);
  }
}

await patchVkPlatform();
await bumpVkPlatformCacheVersion();
await hardenLoaderVisibility();
console.log('VK consent boot-loop hotfix materialized.');
