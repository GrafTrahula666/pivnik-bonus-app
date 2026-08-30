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
const runtimeAnchors = {
  'red-cosmos-v2.css': '--primary-red: #c41e3a',
  'red-cosmos-v2.js': "const EXPECTED_PRIMARY = '#c41e3a';",
  'vk-platform.js': "window.__PIVNIK_PLATFORM__ = 'vk';",
  'migrations/007_red_cosmos_v2.sql': '-- PIVNIK RED COSMOS v2.0',
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

// Keep the current release-candidate QR invariant even though the working CSS
// already hides both controls with a multiline selector.
let redCss = await readText('red-cosmos-v2.css');
const releaseQrGuard = '.platform-vk #qrToken,.platform-vk #copyQrCode{display:none!important}';
if (!redCss.includes(releaseQrGuard)) {
  redCss += `\n${releaseQrGuard}\n`;
  await writeText('red-cosmos-v2.css', redCss);
}

let app = await readText('app.js');
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
if (!index.includes('<meta name="theme-color" content="#c41e3a" />')) failures.push('theme color');
if (index.includes('<div class="boot-badge">Пивник | Бонусы</div>')) failures.push('boot badge');
const finalCss = await readText('red-cosmos-v2.css');
if (!finalCss.includes(releaseQrGuard)) failures.push('release QR guard');
if (failures.length) throw new Error(`working updates verification failed: ${failures.join(', ')}`);

console.log('Working updates overlay is applied and verified.');
