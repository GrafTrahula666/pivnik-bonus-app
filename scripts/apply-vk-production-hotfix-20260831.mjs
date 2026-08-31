import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function write(relativePath, value) {
  await fs.writeFile(path.join(root, relativePath), value, 'utf8');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`VK production hotfix: missing ${label}`);
  return source.replace(from, () => to);
}

let vk = await read('vk-platform.js');
vk = replaceRequired(
  vk,
  `  function sendBridge(method, params) {\n    if (!bridge?.send) return Promise.reject(new Error('VK Bridge unavailable'));\n    return bridgeReady.then(() => bridge.send(method, params));\n  }`,
  `  async function refreshVkProfileOnDemand() {\n    const signedLaunchParams = await resolveLaunchParams();\n    if (!hasSignedLaunchParams(signedLaunchParams)) {\n      throw new Error('VK не передал подписанные параметры запуска.');\n    }\n    const profile = await requestVkUserInfo();\n    if (!profile?.id) {\n      throw new Error('VK не передал фотографию профиля.');\n    }\n    vkUser = profile;\n    const syncResponse = await originalFetch('/api/auth', {\n      method: 'POST',\n      headers: { 'content-type': 'application/json' },\n      body: JSON.stringify({\n        platform: 'vk',\n        launchParams: signedLaunchParams,\n        user: profile\n      })\n    });\n    if (!syncResponse.ok) {\n      throw new Error(\`Не удалось обновить профиль VK (\${syncResponse.status}).\`);\n    }\n    const data = await syncResponse.clone().json().catch(() => null);\n    if (!data?.profile) throw new Error('VK вернул пустой профиль.');\n    const hydration = {\n      profile: data.profile,\n      statuses: data.statuses || [],\n      design: data.design || null\n    };\n    window.__PIVNIK_VK_PROFILE_HYDRATION__ = hydration;\n    window.dispatchEvent(new CustomEvent('pivnik:vk-profile-hydrated', { detail: hydration }));\n    return hydration;\n  }\n\n  window.__PIVNIK_VK_REFRESH_PROFILE__ = refreshVkProfileOnDemand;\n\n  function sendBridge(method, params) {\n    if (!bridge?.send) return Promise.reject(new Error('VK Bridge unavailable'));\n    return bridgeReady.then(() => bridge.send(method, params));\n  }`,
  'on-demand VK profile refresh hook'
);
await write('vk-platform.js', vk);

let app = await read('app.js');
app = replaceRequired(
  app,
  `      button.disabled = !state.profile?.photoUrl;\n      const small = button.querySelector('small');\n      if (small) {\n        small.textContent = state.profile?.photoUrl\n          ? \`Фото из профиля \${PLATFORM_NAME}\`\n          : \`В \${PLATFORM_NAME} нет фото\`;\n      }`,
  `      const hasPlatformPhoto = Boolean(state.profile?.photoUrl);\n      button.disabled = !hasPlatformPhoto && !IS_VK;\n      const small = button.querySelector('small');\n      if (small) {\n        small.textContent = hasPlatformPhoto\n          ? \`Фото из профиля \${PLATFORM_NAME}\`\n          : IS_VK\n            ? 'Нажмите, чтобы загрузить фото VK'\n            : \`В \${PLATFORM_NAME} нет фото\`;\n      }`,
  'VK photo button availability'
);
app = replaceRequired(
  app,
  `$$('#profileSetupModal [data-avatar-source]').forEach((button) => button.addEventListener('click', () => {\n  if (button.disabled) return;\n  state.profileDraft = state.profileDraft || profileDraftFromCurrent();\n  state.profileDraft.avatarSource = button.dataset.avatarSource;\n  state.profileDraft.avatarKey = null;\n  if (!state.profile?.onboardingComplete) state.profileDraft.privacy.showAvatar = button.dataset.avatarSource !== 'telegram';\n  renderProfileSetup();\n}));`,
  `$$('#profileSetupModal [data-avatar-source]').forEach((button) => button.addEventListener('click', async () => {\n  if (button.disabled) return;\n  const source = button.dataset.avatarSource;\n  if (IS_VK && source === 'telegram' && !state.profile?.photoUrl) {\n    const refresh = window.__PIVNIK_VK_REFRESH_PROFILE__;\n    if (typeof refresh !== 'function') {\n      toast('Фото VK пока недоступно');\n      return;\n    }\n    button.disabled = true;\n    try {\n      const hydration = await refresh();\n      if (hydration?.profile) applyVkProfileHydration(hydration);\n    } catch (error) {\n      console.warn('VK profile photo refresh failed:', error);\n      toast(error.message || 'Не удалось загрузить фото VK');\n    } finally {\n      button.disabled = false;\n    }\n    if (!state.profile?.photoUrl) {\n      renderProfileSetup();\n      return;\n    }\n  }\n  state.profileDraft = state.profileDraft || profileDraftFromCurrent();\n  state.profileDraft.avatarSource = source;\n  state.profileDraft.avatarKey = null;\n  if (!state.profile?.onboardingComplete) state.profileDraft.privacy.showAvatar = source !== 'telegram';\n  renderProfileSetup();\n}));`,
  'VK photo selection refresh flow'
);
await write('app.js', app);

let redCss = await read('red-cosmos-v2.css');
const vkBackgroundFix = `
/* PIVNIK_VK_COSMOS_BACKGROUND_20260831
   One visible, low-cost VK background. Inner page containers stay transparent
   so the actual RED COSMOS field is not hidden by their own opaque gradients. */
html.platform-vk,
html.platform-vk body {
  background:#050103!important;
}
html.platform-vk body {
  min-height:100dvh!important;
  background:
    radial-gradient(circle at 12% 13%,rgba(255,255,255,.34) 0 1px,transparent 1.45px),
    radial-gradient(circle at 78% 9%,rgba(255,214,223,.28) 0 1px,transparent 1.4px),
    radial-gradient(circle at 31% 63%,rgba(255,113,142,.22) 0 1px,transparent 1.55px),
    radial-gradient(circle at 89% 76%,rgba(255,255,255,.19) 0 1px,transparent 1.35px),
    radial-gradient(ellipse at 79% 22%,rgba(145,8,46,.34) 0%,rgba(84,4,35,.17) 33%,transparent 58%),
    radial-gradient(ellipse at 18% 76%,rgba(83,8,78,.27) 0%,rgba(64,5,52,.14) 36%,transparent 61%),
    linear-gradient(158deg,#040102 0%,#090205 30%,#16050d 60%,#0a0206 82%,#040102 100%)!important;
  background-size:113px 113px,173px 173px,211px 211px,149px 149px,auto,auto,auto!important;
  background-position:0 0,27px 18px,11px 53px,71px 31px,center,center,center!important;
  animation:none!important;
}
html.platform-vk body::before,
html.platform-vk body::after {
  content:none!important;
  display:none!important;
  animation:none!important;
}
html.platform-vk #appShell,
html.platform-vk #appShell>main,
html.platform-vk .screen {
  background:transparent!important;
  background-image:none!important;
  animation:none!important;
}
html.platform-vk #appShell {
  position:relative!important;
  isolation:isolate!important;
}
`;
if (!redCss.includes('PIVNIK_VK_COSMOS_BACKGROUND_20260831')) {
  redCss += vkBackgroundFix;
  await write('red-cosmos-v2.css', redCss);
}

const finalVk = await read('vk-platform.js');
const finalApp = await read('app.js');
const finalCss = await read('red-cosmos-v2.css');
const failures = [];
if (!finalVk.includes('__PIVNIK_VK_REFRESH_PROFILE__')) failures.push('refresh hook');
if (!finalVk.includes("window.dispatchEvent(new CustomEvent('pivnik:vk-profile-hydrated'")) failures.push('hydration event');
if (!finalApp.includes('button.disabled = !hasPlatformPhoto && !IS_VK')) failures.push('actionable VK photo button');
if (!finalApp.includes('VK profile photo refresh failed:')) failures.push('on-demand photo selection');
if (!finalCss.includes('PIVNIK_VK_COSMOS_BACKGROUND_20260831')) failures.push('VK cosmos background marker');
if (!finalCss.includes('html.platform-vk #appShell>main')) failures.push('transparent VK page canvas');
if (!finalCss.includes('radial-gradient(ellipse at 79% 22%')) failures.push('VK nebula layer');
if (failures.length) throw new Error(`VK production hotfix verification failed: ${failures.join(', ')}`);

console.log('VK production avatar/background hotfix is applied and verified.');
