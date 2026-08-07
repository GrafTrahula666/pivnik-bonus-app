import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = 'VK moderation hardening 2026-08-07';
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
    const lifecycle = `  // ${marker}. Explicitly handle VK lifecycle events so a restored Mini App\n  // refreshes viewport and visible account data instead of relying on WebView state.\n  let bridgeLifecycleInstalled = false;\n  let lastViewRestoreAt = 0;\n\n  function installBridgeLifecycle() {\n    if (bridgeLifecycleInstalled || !bridge?.subscribe) return;\n    bridgeLifecycleInstalled = true;\n    bridge.subscribe((event) => {\n      const type = String(event?.detail?.type || '');\n      if (type === 'VKWebAppViewHide') {\n        document.documentElement.classList.add('vk-view-hidden');\n        return;\n      }\n      if (type === 'VKWebAppViewRestore') {\n        document.documentElement.classList.remove('vk-view-hidden');\n        syncVisualViewport();\n        const now = Date.now();\n        if (now - lastViewRestoreAt > 1000) {\n          lastViewRestoreAt = now;\n          window.dispatchEvent(new CustomEvent('pivnik:vk-view-restore'));\n          window.setTimeout(() => document.getElementById('refreshButton')?.click(), 0);\n        }\n        return;\n      }\n      if (type === 'VKWebAppUpdateConfig') {\n        syncVisualViewport();\n        window.dispatchEvent(new CustomEvent('pivnik:vk-config-updated', { detail: event?.detail?.data || {} }));\n      }\n    });\n  }\n\n  void bridgeReady.then(() => installBridgeLifecycle()).catch(() => {});\n\n`;
    vk = replaceRequired(vk, anchor, `${lifecycle}${anchor}`, 'VK lifecycle subscription');
  }
  await write('vk-platform.js', vk);
}

async function patchGateway() {
  let gateway = await read('universal-server.js');
  gateway = gateway.replace(/const MAX_BODY_BYTES = [^;]+;/, 'const MAX_BODY_BYTES = 4 * 1024 * 1024;');
  gateway = gateway.replace(/const TERMS_VERSION = '[^']+';/, "const TERMS_VERSION = '2026-08-07';");
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
await patchGateway();
await patchServer();

const [index, vk, gateway, server] = await Promise.all([
  read('index.html'),
  read('vk-platform.js'),
  read('universal-server.js'),
  read('server.js')
]);

const failures = [];
if (!index.includes('/legal/terms') || !index.includes('/legal/privacy')) failures.push('direct legal links');
if (!index.includes('Подтверждаю 18+ и принимаю')) failures.push('explicit 18+ consent');
if (!index.includes('Лига — информационный рейтинг')) failures.push('league rules copy');
if (!index.includes('до 3 МБ')) failures.push('upload copy');
if (!vk.includes(marker) || !vk.includes('bridge.subscribe') || !vk.includes('VKWebAppViewRestore')) failures.push('VK lifecycle');
if (!gateway.includes('const MAX_BODY_BYTES = 4 * 1024 * 1024;')) failures.push('gateway body limit');
if (!gateway.includes("const TERMS_VERSION = '2026-08-07';")) failures.push('gateway terms version');
if (!server.includes("express.json({ limit: '4mb' })")) failures.push('server body limit');
if (!server.includes('moderation-remove-profile-frames-from-shop')) failures.push('shop frame cleanup');
for (const code of removedShopFrameCodes) {
  if (!server.includes(`'${code}'`)) failures.push(`shop cleanup code ${code}`);
}
if (failures.length) throw new Error(`VK moderation hardening incomplete: ${failures.join(', ')}`);

console.log('VK moderation hardening applied and verified.');
