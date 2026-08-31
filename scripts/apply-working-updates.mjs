import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptDir = path.join(root, 'scripts');

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function writeText(relativePath, value) {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, value, 'utf8');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`working updates: missing ${label}`);
  return source.replace(from, () => to);
}

const payloadParts = ['working-updates-runtime-1.txt', 'working-updates-runtime-2.txt', 'working-updates-runtime-3.txt'];
const payloadBase64 = (await Promise.all(payloadParts.map((name) => fs.readFile(path.join(scriptDir, name), 'utf8')))).join('').trim();
const runtimeFiles = JSON.parse(zlib.gunzipSync(Buffer.from(payloadBase64, 'base64')).toString('utf8'));
// Applied SQL migrations are immutable. Updates to RED COSMOS recipients live in migration 008.
delete runtimeFiles['migrations/007_red_cosmos_v2.sql'];
const runtimeAnchors = {
  'red-cosmos-v2.css': '--primary-red: #c41e3a',
  'red-cosmos-v2.js': "const EXPECTED_PRIMARY = '#c41e3a';",
  'vk-platform.js': "window.__PIVNIK_PLATFORM__ = 'vk';",
  'scripts/red-cosmos-v2-db-prepare.mjs': "const BACKUP_SCHEMA = 'pivnik_red_cosmos_v2_preupgrade_20260827';",
  'scripts/v22-data-audit-and-repair.mjs': "const ACHIEVEMENT_CODE = 'raise-shields';"
};

for (const [relativePath, targetContent] of Object.entries(runtimeFiles)) {
  const existing = await readText(relativePath);
  if (existing === targetContent) continue;
  const anchor = runtimeAnchors[relativePath];
  if (!anchor || !existing.includes(anchor)) {
    throw new Error(`working updates: unexpected source drift in ${relativePath}`);
  }
  await writeText(relativePath, targetContent);
}

// VK profile photo sync hardening 2026-08-31. Signed auth remains fast, while
// background VK profile hydration gets bounded retries for slow WebViews/devices.
let vkPlatform = await readText('vk-platform.js');
vkPlatform = replaceRequired(
  vkPlatform,
  `  const BRIDGE_PROFILE_TIMEOUT_MS = 2200;`,
  `  const BRIDGE_PROFILE_TIMEOUT_MS = 2200;\n  const VK_PROFILE_SYNC_RETRY_DELAYS_MS = [0, 1400, 3600];`,
  'VK profile sync retry delays'
);
vkPlatform = replaceRequired(
  vkPlatform,
  `  const profileReady = (async () => {\n    await bridgeReady;\n    if (!bridge?.send) return null;\n    try {\n      vkUser = await withTimeout(\n        bridge.send('VKWebAppGetUserInfo'),\n        BRIDGE_PROFILE_TIMEOUT_MS,\n        'VK не передал данные профиля вовремя.'\n      );\n    } catch (error) {\n      console.warn('VK user info unavailable:', error);\n      vkUser = null;\n    }\n    if (vkUser?.id && launchVkUserId && String(vkUser.id) !== launchVkUserId) {\n      console.warn('VK profile does not match signed launch parameters; profile data ignored.');\n      vkUser = null;\n    }\n    return vkUser;\n  })();`,
  `  async function requestVkUserInfo() {\n    await bridgeReady;\n    if (!bridge?.send) return null;\n    let lastError = null;\n    for (const retryDelay of VK_PROFILE_SYNC_RETRY_DELAYS_MS) {\n      if (retryDelay) await new Promise((resolve) => window.setTimeout(resolve, retryDelay));\n      try {\n        const profile = await withTimeout(\n          bridge.send('VKWebAppGetUserInfo'),\n          BRIDGE_PROFILE_TIMEOUT_MS,\n          'VK не передал данные профиля вовремя.'\n        );\n        if (profile?.id && launchVkUserId && String(profile.id) !== launchVkUserId) {\n          console.warn('VK profile does not match signed launch parameters; profile data ignored.');\n          return null;\n        }\n        if (profile?.id) return profile;\n      } catch (error) {\n        lastError = error;\n      }\n    }\n    if (lastError) console.warn('VK user info unavailable after retries:', lastError);\n    return null;\n  }\n\n  const profileReady = (async () => {\n    vkUser = await requestVkUserInfo();\n    return vkUser;\n  })();`,
  'VK profile sync retries'
);
await writeText('vk-platform.js', vkPlatform);

// Service-role reconciliation 2026-08-31. Owner authorization is derived from
// the authenticated provider identity, and must not depend on whether legacy
// multi-identity profile metadata is eligible for refresh.
let platformCore = await readText('platform-core.js');
if (!platformCore.includes('export function isConfiguredOwnerIdentity(')) {
  const ownerHelperAnchor = `export function strongestRole(left, right) {`;
  if (!platformCore.includes(ownerHelperAnchor)) throw new Error('working updates: missing platform owner helper anchor');
  const ownerHelper = `export function isConfiguredOwnerIdentity(provider, providerUserId, configuredOwners = {}) {
  const normalizedProvider = provider === 'vk' ? 'vk' : provider === 'telegram' ? 'telegram' : '';
  if (!normalizedProvider) return false;
  const actualId = String(providerUserId || '').trim();
  const configuredId = String(configuredOwners[normalizedProvider] || '').trim();
  return Boolean(actualId && configuredId && actualId === configuredId);
}

`;
  platformCore = platformCore.replace(ownerHelperAnchor, () => ownerHelper + ownerHelperAnchor);
  await writeText('platform-core.js', platformCore);
}

let gateway = await readText('universal-server.js');
gateway = replaceRequired(
  gateway,
  `  hashLinkCode,\n  normalizeLinkCode as normalizeCoreLinkCode,`,
  `  hashLinkCode,\n  isConfiguredOwnerIdentity,\n  normalizeLinkCode as normalizeCoreLinkCode,`,
  'configured owner identity import'
);
gateway = replaceRequired(
  gateway,
  `    const isOwner = provider === 'telegram'\n      ? Boolean(ownerTelegramId && externalUser.id === ownerTelegramId)\n      : Boolean(ownerVkId && externalUser.id === ownerVkId);`,
  `    const isOwner = isConfiguredOwnerIdentity(provider, externalUser.id, {\n      telegram: ownerTelegramId,\n      vk: ownerVkId\n    });`,
  'provider owner identity mapping'
);
gateway = replaceRequired(
  gateway,
  `    } else {\n      const identityCount = await client.query(`,
  `    } else {\n      // Authorization is independent from profile-metadata ownership. Legacy rows can\n      // still contain both platform identities; a signed configured owner must regain\n      // the persisted admin role even when shouldUpdateMainProfile is false.\n      if (isOwner) {\n        await client.query(\n          \`UPDATE users\n           SET role = 'admin',\n               updated_at = CASE WHEN role <> 'admin' THEN NOW() ELSE updated_at END\n           WHERE id = $1::bigint\n             AND role <> 'admin'\`,\n          [userId]\n        );\n      }\n\n      const identityCount = await client.query(`,
  'owner role reconciliation outside profile refresh'
);
await writeText('universal-server.js', gateway);

// Keep the current release-candidate QR invariant even though the working CSS
// already hides both controls with a multiline selector.
let redCss = await readText('red-cosmos-v2.css');
const releaseQrGuard = '.platform-vk #qrToken,.platform-vk #copyQrCode{display:none!important}';
if (!redCss.includes(releaseQrGuard)) {
  redCss += `\n${releaseQrGuard}\n`;
  await writeText('red-cosmos-v2.css', redCss);
}

const vkBottomNavFix = `
/* PIVNIK_VK_BOTTOM_NAV_SAFE_AREA_20260831 */
.platform-vk .bottom-nav {
  box-sizing:border-box!important;
  height:auto!important;
  min-height:calc(72px + env(safe-area-inset-bottom))!important;
  padding:7px 7px max(7px, env(safe-area-inset-bottom))!important;
  align-items:center!important;
}
.platform-vk .bottom-nav::before {
  content:none!important;
  display:none!important;
}
.platform-vk .bottom-nav .qr-nav-button {
  min-height:56px!important;
  justify-content:center!important;
  gap:2px!important;
}
.platform-vk .bottom-nav .qr-nav-button > span {
  width:50px!important;
  height:50px!important;
  margin-top:0!important;
  box-shadow:0 5px 20px rgba(196,30,58,.28),inset 0 1px 1px rgba(255,255,255,.34)!important;
}
`;
if (!redCss.includes('PIVNIK_VK_BOTTOM_NAV_SAFE_AREA_20260831')) {
  redCss += vkBottomNavFix;
  await writeText('red-cosmos-v2.css', redCss);
}

let app = await readText('app.js');
const vkClientTipStart = `  const hero = $('.hero-card');\n  if (IS_VK && hero && !$('.client-tip')) {\n`;
const vkClientTipEnd = `\n\n  const scan = $('#scanClient');`;
if (app.includes(vkClientTipStart)) {
  const tipStart = app.indexOf(vkClientTipStart);
  const tipEnd = app.indexOf(vkClientTipEnd, tipStart);
  if (tipEnd < 0) throw new Error('working updates: malformed VK client tip block');
  app = app.slice(0, tipStart) + `  const scan = $('#scanClient');` + app.slice(tipEnd + vkClientTipEnd.length);
}
app = replaceRequired(
  app,
  `function switchScreen(target, navigation = {}) {\n  if (!target) return;`,
  `function switchScreen(target, navigation = {}) {\n  if (!target) return;\n  if (target === 'staff' && !roleCanStaff(state.profile?.role)) return;\n  if (target === 'admin' && !roleCanAdmin(state.profile?.role)) return;`,
  'service screen role guard'
);
app = replaceRequired(
  app,
  `  if (source === 'telegram' && entity.photoUrl) return entity.photoUrl;`,
  `  if ((source === 'telegram' || source === 'vk') && entity.photoUrl) return entity.photoUrl;`,
  'VK avatar source support'
);
app = replaceRequired(
  app,
  `    frameOptions.innerHTML = availableFrames.map((frame) => \`<button type="button" class="profile-frame-choice \${state.profileDraft.profileFrame === frame.code ? 'active' : ''}" data-profile-frame="\${escapeHtml(frame.code)}"><span class="frame-choice-preview \${frame.code !== 'none' ? \`avatar-frame-\${escapeHtml(frame.code)}\` : ''}">\${frame.code === 'none' ? '—' : '◆'}</span><b>\${escapeHtml(frame.title)}</b></button>\`).join('');`,
  `    frameOptions.innerHTML = availableFrames.map((frame) => {\n      const previewEntity = { ...selectedAvatarPreview(), profileFrame: frame.code };\n      return \`<button type="button" class="profile-frame-choice \${state.profileDraft.profileFrame === frame.code ? 'active' : ''}" data-profile-frame="\${escapeHtml(frame.code)}"><span class="frame-choice-preview">\${frame.code === 'none' ? '<span class="frame-choice-none">—</span>' : avatarInlineHtml(previewEntity, 'frame-choice-avatar')}</span><b>\${escapeHtml(frame.title)}</b></button>\`;\n    }).join('');`,
  'real frame preview'
);
app = replaceRequired(
  app,
  `function renderWheelArtwork() {\n  if (IS_VK || state.wheel.artworkReady) return;`,
  `function renderWheelArtwork() {\n  if (state.wheel.artworkReady) return;`,
  'VK wheel artwork'
);
app = replaceRequired(
  app,
  `  $('#profileServiceAccess')?.classList.toggle('hidden', !hasStaffAccess && !hasAdminAccess);`,
  `  const serviceAccess = $('#profileServiceAccess');\n  serviceAccess?.classList.toggle('hidden', !hasStaffAccess && !hasAdminAccess);\n  if (IS_VK && serviceAccess && (hasStaffAccess || hasAdminAccess)) {\n    $('.profile-shortcuts')?.insertAdjacentElement('afterend', serviceAccess);\n  }`,
  'VK service access placement'
);

const hydrationBlock = `function applyVkProfileHydration(data) {\n  if (!IS_VK || !data?.profile) return;\n  if (state.profile?.id && String(state.profile.id) !== String(data.profile.id)) return;\n  applyProfilePayload(data);\n}\n\nwindow.addEventListener('pivnik:vk-profile-hydrated', (event) => {\n  applyVkProfileHydration(event.detail);\n});\n\nif (window.__PIVNIK_VK_PROFILE_HYDRATION__) {\n  applyVkProfileHydration(window.__PIVNIK_VK_PROFILE_HYDRATION__);\n}\n\n`;
if (!app.includes(hydrationBlock)) {
  const marker = `async function loadSecondaryData() {`;
  if (!app.includes(marker)) throw new Error('working updates: missing VK hydration insertion point');
  app = app.replace(marker, () => hydrationBlock + marker);
}

app = replaceRequired(
  app,
  `  openAchievements();\n}`,
  `  openAchievements();\n  if (!state.achievementsLoaded) {\n    void loadAchievements().catch((error) => {\n      console.warn('Achievement hub refresh skipped:', error);\n      const catalog = $('#achievementCatalog');\n      if (catalog && !state.achievementsLoaded) catalog.innerHTML = \`<div class="achievement-catalog-empty">\${escapeHtml(error.message || 'Не удалось загрузить достижения.')}</div>\`;\n    });\n  }\n}`,
  'achievement hub refresh'
);
await writeText('app.js', app);

let index = await readText('index.html');
index = replaceRequired(
  index,
  `<meta name="theme-color" content="#0b0e13" />`,
  `<meta name="theme-color" content="#c41e3a" />`,
  'RED COSMOS theme color'
);
if (index.includes('        <div class="boot-badge">Пивник | Бонусы</div>\n')) {
  index = index.replace('        <div class="boot-badge">Пивник | Бонусы</div>\n', '');
}
await writeText('index.html', index);

const failures = [];
if (!app.includes("(source === 'telegram' || source === 'vk') && entity.photoUrl")) failures.push('VK avatar source');
if (!app.includes("avatarInlineHtml(previewEntity, 'frame-choice-avatar')")) failures.push('frame previews');
if (app.includes('if (IS_VK || state.wheel.artworkReady) return;')) failures.push('VK wheel artwork');
if (!app.includes("$('.profile-shortcuts')?.insertAdjacentElement('afterend', serviceAccess)")) failures.push('service access placement');
if (!app.includes('pivnik:vk-profile-hydrated')) failures.push('VK profile hydration');
if (!app.includes('Achievement hub refresh skipped:')) failures.push('achievement refresh');
if (!platformCore.includes('export function isConfiguredOwnerIdentity(')) failures.push('configured owner identity helper');
if (!gateway.includes('isConfiguredOwnerIdentity(provider, externalUser.id')) failures.push('provider owner identity mapping');
if (!gateway.includes('Authorization is independent from profile-metadata ownership')) failures.push('owner role reconciliation');
if (!index.includes('<meta name="theme-color" content="#c41e3a" />')) failures.push('theme color');
if (index.includes('<div class="boot-badge">Пивник | Бонусы</div>')) failures.push('boot badge');
const finalCss = await readText('red-cosmos-v2.css');
if (!finalCss.includes(releaseQrGuard)) failures.push('release QR guard');
if (failures.length) throw new Error(`working updates verification failed: ${failures.join(', ')}`);

console.log('Working updates overlay is applied and verified.');
