import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');
const serverPath = path.join(root, 'server.js');
const vkPlatformPath = path.join(root, 'vk-platform.js');
const marker = 'Anna frame entitlement and consent persistence hotfix 2026-08-06';
const cacheVersion = '3.2.2-anna-consent-persistence';

function replaceFunction(source, name, replacement) {
  const pattern = new RegExp(`function ${name}\\(row\\) \\{[\\s\\S]*?\\n\\}`, 'm');
  if (!pattern.test(source)) {
    throw new Error(`Function ${name} was not found.`);
  }
  return source.replace(pattern, replacement);
}

function patchFrameEntitlement(source) {
  if (source.includes(marker)) return source;

  source = replaceFunction(source, 'profileFrameFromRow', `function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  const storedFrame = String(row?.profile_frame || row?.profileFrame || '');
  // ${marker}. The persisted personal frame is itself an entitlement. It must
  // survive role changes, VK/Telegram account linking and missing optional env vars.
  if (isAnnaRow(row) || storedFrame === 'anna') return 'anna';
  if (row?.role === 'viewer') return 'fire';
  return ['money', 'fire', 'diamond'].includes(storedFrame) ? storedFrame : 'none';
}`);

  source = replaceFunction(source, 'availableFramesFromRow', `function availableFramesFromRow(row) {
  if (isOwnerRow(row)) return [{ code: 'money', title: 'Долларовая рамка' }];
  const storedFrame = String(row?.profile_frame || row?.profileFrame || '');
  if (isAnnaRow(row) || storedFrame === 'anna') {
    return [{ code: 'anna', title: 'Персональная рамка Анны' }];
  }
  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];
  const frames = [{ code: 'none', title: 'Без рамки' }];
  if (row?.owns_diamond_frame || storedFrame === 'diamond') {
    frames.push({ code: 'diamond', title: 'Алмазная рамка' });
  }
  return frames;
}`);

  return source;
}

async function patchServers() {
  for (const filePath of [gatewayPath, serverPath]) {
    const source = await fs.readFile(filePath, 'utf8');
    const next = patchFrameEntitlement(source);
    if (next !== source) await fs.writeFile(filePath, next, 'utf8');
  }
}

async function patchVkConsentPersistence() {
  let source = await fs.readFile(vkPlatformPath, 'utf8');
  if (!source.includes(marker)) {
    const originalInspector = `  async function inspectApiResponse(response) {
    try {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = await response.clone().json();
      if (data?.profile) updateConsentState(data.profile);
    } catch (_) {}
  }`;
    const fixedInspector = `  async function inspectApiResponse(response, { allowOpen = true } = {}) {
    try {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = await response.clone().json();
      if (!data?.profile) return;

      // ${marker}. A returning VK user can receive a transient auth payload
      // before the canonical /api/me profile is hydrated. A transient false
      // must never reopen the terms window after the server already persisted consent.
      if (data.profile.termsAccepted === true) {
        updateConsentState(data.profile);
      } else if (allowOpen) {
        updateConsentState(data.profile);
      }
    } catch (_) {}
  }`;
    if (!source.includes(originalInspector)) {
      throw new Error('VK consent response inspector was not found.');
    }
    source = source.replace(originalInspector, fixedInspector);

    source = source.replace(
      '      void inspectApiResponse(response);\n      return response;',
      '      await inspectApiResponse(response, { allowOpen: false });\n      return response;'
    );

    const originalProfileBlock = `    const response = await originalFetch(input, init);
    if (pathname === '/api/me' || pathname === '/api/me/consent') {
      void inspectApiResponse(response);
      if (pathname === '/api/me/consent') consentExplicit = false;
    }
    return response;`;
    const fixedProfileBlock = `    const response = await originalFetch(input, init);
    if (pathname === '/api/me' || pathname === '/api/me/consent') {
      try {
        await inspectApiResponse(response, { allowOpen: true });
      } finally {
        if (pathname === '/api/me/consent') consentExplicit = false;
      }
    }
    return response;`;
    if (!source.includes(originalProfileBlock)) {
      throw new Error('VK profile/consent response block was not found.');
    }
    source = source.replace(originalProfileBlock, fixedProfileBlock);
  }

  await fs.writeFile(vkPlatformPath, source, 'utf8');
}

async function bumpVkCache() {
  let source = await fs.readFile(gatewayPath, 'utf8');
  const next = source.replace(/vk-platform\.js\?v=[^"\\]+/g, `vk-platform.js?v=${cacheVersion}`);
  if (next === source && !source.includes(`vk-platform.js?v=${cacheVersion}`)) {
    throw new Error('VK platform cache reference was not found.');
  }
  if (next !== source) await fs.writeFile(gatewayPath, next, 'utf8');
}

await patchServers();
await patchVkConsentPersistence();
await bumpVkCache();
console.log('Anna frame and consent persistence hotfix materialized.');
