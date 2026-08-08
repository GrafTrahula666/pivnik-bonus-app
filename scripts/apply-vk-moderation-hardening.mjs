import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = 'VK moderation hardening 2026-08-07';
const startupMarker = 'VK deterministic startup hardening 2026-08-07';
const vkBridgeCacheVersion = '3.3.0-vk-startup-stable';
const removedShopFrameCodes = ['frame-money-owner', 'frame-fire-partner', 'frame-diamond'];

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function write(relativePath, content) {
  await fs.writeFile(path.join(root, relativePath), content, 'utf8');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Не найден moderation-фрагмент: ${label}`);
  return source.replace(from, to);
}

function replacePatternRequired(source, pattern, replacement, markerText, label) {
  if (source.includes(markerText)) return source;
  if (!pattern.test(source)) throw new Error(`Не найден moderation-фрагмент: ${label}`);
  return source.replace(pattern, replacement);
}

async function patchIndex() {
  let index = await read('index.html');

  if (!index.includes(`data-moderation-hardening="${marker}"`)) {
    index = replacePatternRequired(
      index,
      /(<button\b[^>]*\bid="openTermsFromConsent"[^>]*>[\s\S]*?<\/button>)/,
      `$1\n      <div class="consent-legal-links" data-moderation-hardening="${marker}">\n        <a class="text-link" href="/legal/terms" target="_blank" rel="noopener noreferrer">Пользовательское соглашение</a>\n        <a class="text-link" href="/legal/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a>\n        <a class="text-link" href="mailto:origtopg666@gmail.com">Написать в поддержку</a>\n      </div>`,
      `data-moderation-hardening="${marker}"`,
      'прямые юридические ссылки на consent-экране'
    );
  }

  index = index.replace(
    /(<button\b[^>]*\bid="acceptTerms"[^>]*>)[\s\S]*?(<\/button>)/,
    '$1Подтверждаю 18+ и принимаю$2'
  );

  index = index.replace(
    /<div class="leaderboard-prize-note" id="leaderboardPrizeNote">[\s\S]*?<\/div>/,
    '<div class="leaderboard-prize-note" id="leaderboardPrizeNote">Лига — информационный рейтинг по подтверждённым покупкам. Если для сезона объявляется приз, полные условия, сроки и порядок получения публикуются в приложении до начала сезона.</div>'
  );

  index = index.replaceAll('JPG, PNG или WEBP · до 6 МБ', 'JPG, PNG или WEBP · до 3 МБ');

  if (!index.includes('id="moderationHelpLegalLinks"')) {
    const helpIntro = '<p class="help-intro">Здесь собраны правила бонусной программы, инструкция по использованию приложения и ответы на частые вопросы. Для быстрого просмотра откройте нужный пункт.</p>';
    index = replaceRequired(
      index,
      helpIntro,
      `${helpIntro}\n      <div class="consent-legal-links" id="moderationHelpLegalLinks">\n        <a class="text-link" href="/legal/terms" target="_blank" rel="noopener noreferrer">Пользовательское соглашение</a>\n        <a class="text-link" href="/legal/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a>\n        <a class="text-link" href="mailto:origtopg666@gmail.com">Поддержка: origtopg666@gmail.com</a>\n      </div>`,
      'юридические ссылки в справке'
    );
  }

  await write('index.html', index);
}

async function patchVkLifecycle() {
  let vk = await read('vk-platform.js');
  if (!vk.includes(marker)) {
    const anchor = '  const profileReady = (async () => {';
    const lifecycle = `  // ${marker}. Explicitly handle VK lifecycle events. View restore only\n  // emits an application event: it must never click UI controls during boot.\n  let bridgeLifecycleInstalled = false;\n  let lastViewRestoreAt = 0;\n\n  function installBridgeLifecycle() {\n    if (bridgeLifecycleInstalled || !bridge?.subscribe) return;\n    bridgeLifecycleInstalled = true;\n    bridge.subscribe((event) => {\n      const type = String(event?.detail?.type || '');\n      if (type === 'VKWebAppViewHide') {\n        document.documentElement.classList.add('vk-view-hidden');\n        return;\n      }\n      if (type === 'VKWebAppViewRestore') {\n        document.documentElement.classList.remove('vk-view-hidden');\n        syncVisualViewport();\n        const now = Date.now();\n        if (now - lastViewRestoreAt > 1000) {\n          lastViewRestoreAt = now;\n          window.dispatchEvent(new CustomEvent('pivnik:vk-view-restore'));\n        }\n        return;\n      }\n      if (type === 'VKWebAppUpdateConfig') {\n        syncVisualViewport();\n        window.dispatchEvent(new CustomEvent('pivnik:vk-config-updated', { detail: event?.detail?.data || {} }));\n      }\n    });\n  }\n\n  void bridgeReady.then(() => installBridgeLifecycle()).catch(() => {});\n\n`;
    vk = replaceRequired(vk, anchor, `${lifecycle}${anchor}`, 'VK lifecycle subscription');
  }
  await write('vk-platform.js', vk);
}

async function patchDeterministicStartup() {
  let app = await read('app.js');
  if (!app.includes(startupMarker)) {
    const oldBootTail = `    $('#bootText').textContent = 'Открываем профиль…';
    renderCoreProfile();
    await finishBoot();
    closeModal('consentModal');
    closeModal('profileSetupModal');
    schedulePostBootHydration();`;
    const newBootTail = `    $('#bootText').textContent = 'Открываем профиль…';
    renderCoreProfile();
    await finishBoot();
    // ${startupMarker}. Once a profile exists the boot overlay is never allowed\n    // to cover the app again. Consent is shown deterministically after the app shell\n    // becomes visible instead of racing MutationObserver and boot cleanup.\n    if (state.profile?.termsAccepted) closeModal('consentModal');
    else window.setTimeout(() => openModal('consentModal'), 0);
    closeModal('profileSetupModal');
    schedulePostBootHydration();`;
    app = replaceRequired(app, oldBootTail, newBootTail, 'детерминированное завершение boot');

    const oldBootCatch = `  } catch (error) {
    console.error('Boot failed:', error);
    const message = error?.status === 401
      ? (IS_VK
          ? \`Не удалось войти в VK: \${error?.message || 'параметры запуска не подтверждены.'}\`
          : 'Telegram не передал данные входа. Закройте окно и откройте приложение ещё раз.')
      : (error?.message || 'Не удалось загрузить приложение.');
    showBootActions(message);
  }
}`;
    const newBootCatch = `  } catch (error) {
    console.error('Boot failed:', error);
    const message = error?.status === 401
      ? (IS_VK
          ? \`Не удалось войти в VK: \${error?.message || 'параметры запуска не подтверждены.'}\`
          : 'Telegram не передал данные входа. Закройте окно и откройте приложение ещё раз.')
      : (error?.message || 'Не удалось загрузить приложение.');
    if (IS_VK && state.profile) {
      renderCoreProfile();
      await finishBoot();
      if (!state.profile?.termsAccepted) window.setTimeout(() => openModal('consentModal'), 0);
      toast('Профиль открыт. Часть данных обновится автоматически.');
      schedulePostBootHydration();
    } else {
      showBootActions(message);
    }
  }
}`;
    app = replaceRequired(app, oldBootCatch, newBootCatch, 'failsafe после уже полученного VK-профиля');

    const visibilityBlock = `document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshTelegramBridge();
});`;
    const restoreBlock = `${visibilityBlock}\nwindow.addEventListener('pivnik:vk-view-restore', () => {\n  if (!IS_VK || !state.token || !state.profile) return;\n  void refreshMe().catch((error) => console.warn('VK restore refresh skipped:', error));\n});`;
    app = replaceRequired(app, visibilityBlock, restoreBlock, 'безопасное обновление после VK ViewRestore');
  }
  await write('app.js', app);
}

async function patchLoaderFailsafe() {
  let css = await read('loader-fix.css');
  const hiddenBlock = `.boot-screen.hidden {\n  opacity: 0 !important;\n  visibility: hidden !important;\n  pointer-events: none !important;\n}`;
  const hiddenBlockWithDisplay = `.boot-screen.hidden {\n  display: none !important;\n  opacity: 0 !important;\n  visibility: hidden !important;\n  pointer-events: none !important;\n}`;
  if (!css.includes(hiddenBlockWithDisplay)) {
    css = replaceRequired(css, hiddenBlock, hiddenBlockWithDisplay, 'жёсткое скрытие boot-screen');
  }
  await write('loader-fix.css', css);
}

async function patchGateway() {
  let gateway = await read('universal-server.js');
  gateway = gateway.replace(/const MAX_BODY_BYTES = [^;]+;/, 'const MAX_BODY_BYTES = 4 * 1024 * 1024;');
  gateway = gateway.replace(/const TERMS_VERSION = '[^']+';/, "const TERMS_VERSION = '2026-08-07';");
  gateway = gateway.replace(/vk-platform\.js\?v=[^"\\]+/g, `vk-platform.js?v=${vkBridgeCacheVersion}`);
  // app.js is versioned in index.html by the public-release pass. Do not overwrite
  // that independently here: doing so made the two release guards fight each other.
  await write('universal-server.js', gateway);
}

async function patchServer() {
  let server = await read('server.js');
  server = server.replace("app.use(express.json({ limit: '1mb' }));", "app.use(express.json({ limit: '4mb' }));");
  server = server.replace(/const TERMS_VERSION = '[^']+';/, "const TERMS_VERSION = '2026-08-07';");

  const originalLoop = '    for (const item of DEFAULT_SHOP_ITEMS) {';
  const filteredLoop = `    for (const item of DEFAULT_SHOP_ITEMS.filter((item) => !${JSON.stringify(removedShopFrameCodes)}.includes(item.code))) {`;
  server = replaceRequired(server, originalLoop, filteredLoop, 'исключение рамок из default-каталога');

  if (!server.includes('moderation-remove-profile-frames-from-shop')) {
    const indexAnchor = "    await client.query('CREATE INDEX IF NOT EXISTS idx_promotions_sort ON promotions(sort_order, id)');";
    const cleanup = `    // ${marker}: moderation-remove-profile-frames-from-shop\n    await client.query(\n      \"DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond')\"\n    );\n`;
    server = replaceRequired(server, indexAnchor, `${cleanup}${indexAnchor}`, 'удаление уже созданных рамок из БД магазина');
  }

  await write('server.js', server);
}

await patchIndex();
await patchVkLifecycle();
await patchDeterministicStartup();
await patchLoaderFailsafe();
await patchGateway();
await patchServer();

const [index, app, vk, loader, gateway, server] = await Promise.all([
  read('index.html'),
  read('app.js'),
  read('vk-platform.js'),
  read('loader-fix.css'),
  read('universal-server.js'),
  read('server.js')
]);

const failures = [];
if (!index.includes('/legal/terms') || !index.includes('/legal/privacy')) failures.push('direct legal links');
if (!index.includes('Подтверждаю 18+ и принимаю')) failures.push('explicit 18+ consent');
if (!index.includes('Лига — информационный рейтинг')) failures.push('league rules copy');
if (!index.includes('до 3 МБ')) failures.push('upload copy');
if (!app.includes(startupMarker)) failures.push('deterministic VK boot');
if (!app.includes("addEventListener('pivnik:vk-view-restore'")) failures.push('safe VK restore refresh');
if (!vk.includes(marker) || !vk.includes('bridge.subscribe') || !vk.includes('VKWebAppViewRestore')) failures.push('VK lifecycle');
if (vk.includes("document.getElementById('refreshButton')?.click()")) failures.push('unsafe restore click remains');
if (!loader.includes('.boot-screen.hidden {\n  display: none !important;')) failures.push('loader hard hide');
if (!gateway.includes('const MAX_BODY_BYTES = 4 * 1024 * 1024;')) failures.push('gateway body limit');
if (!gateway.includes("const TERMS_VERSION = '2026-08-07';")) failures.push('gateway terms version');
if (!gateway.includes(`vk-platform.js?v=${vkBridgeCacheVersion}`)) failures.push('VK cache version');
if (!/app\.js\?v=[^"']+/.test(index)) failures.push('app cache busting');
if (!server.includes("express.json({ limit: '4mb' })")) failures.push('server body limit');
if (!server.includes('moderation-remove-profile-frames-from-shop')) failures.push('shop frame cleanup');
for (const code of removedShopFrameCodes) {
  if (!server.includes(`'${code}'`)) failures.push(`shop cleanup code ${code}`);
}
if (failures.length) throw new Error(`VK moderation/startup hardening incomplete: ${failures.join(', ')}`);

console.log('VK moderation and deterministic startup hardening applied and verified.');
