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

const finalVk = await read('vk-platform.js');
const finalApp = await read('app.js');
const failures = [];
if (!finalVk.includes('__PIVNIK_VK_REFRESH_PROFILE__')) failures.push('refresh hook');
if (!finalVk.includes("window.dispatchEvent(new CustomEvent('pivnik:vk-profile-hydrated'")) failures.push('hydration event');
if (!finalApp.includes('button.disabled = !hasPlatformPhoto && !IS_VK')) failures.push('actionable VK photo button');
if (!finalApp.includes('VK profile photo refresh failed:')) failures.push('on-demand photo selection');
if (failures.length) throw new Error(`VK production hotfix verification failed: ${failures.join(', ')}`);

console.log('VK production avatar hotfix is applied and verified.');
