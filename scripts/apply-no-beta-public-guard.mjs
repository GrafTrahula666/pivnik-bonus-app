import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = 'Public no-beta guard 2026-08-08';
const syncStart = '// PIVNIK_PUBLIC_RELEASE_SYNC_START';
const syncEnd = '// PIVNIK_PUBLIC_RELEASE_SYNC_END';
const cacheVersion = '3.5.0-no-beta-auto-refresh';
const buildId = String(
  process.env.RAILWAY_GIT_COMMIT_SHA
  || process.env.RAILWAY_DEPLOYMENT_ID
  || cacheVersion
).trim().slice(0, 96);

const forbidden = [
  'закрытая бета',
  'ЗАКРЫТАЯ БЕТА',
  'Правила бета-тестирования',
  'режиме закрытого теста',
  'Версия документа: бета',
  'Рабочая редакция для закрытого бета-теста',
  'Награды за 1–3 место появятся после бета-теста.',
  '>Тестировщик</h2>'
];

async function read(name) {
  return fs.readFile(path.join(root, name), 'utf8');
}

async function write(name, value) {
  await fs.writeFile(path.join(root, name), value, 'utf8');
}

function escapeForSingleQuotedJs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

let index = await read('index.html');
index = index.replace(/<span class="beta-badge">[\s\S]*?<\/span>/gi, '');
index = index.replaceAll('Правила бета-тестирования', 'Работа приложения');
index = index.replaceAll(
  'Приложение находится в режиме закрытого теста. Интерфейс, расчёты и отдельные функции могут изменяться.',
  'Приложение работает как программа лояльности бара «ПИВНИК». Актуальные условия опубликованы в правилах.'
);
index = index.replaceAll(
  'Возможны временные ошибки, задержки обновления данных и недоступность отдельных разделов. О найденных проблемах нужно сообщать владельцу или сотруднику.',
  'При технической ошибке или задержке обновления данных обратитесь к сотруднику бара.'
);
index = index.replaceAll(
  'Планируется сохранить бонусы и статусы, накопленные в бета-тесте, если до завершения теста не будет объявлено иное.',
  'Бонусы, статусы и история операций сохраняются в профиле согласно действующим правилам программы.'
);
index = index.replaceAll('Версия документа: бета 0.4', 'Редакция правил: 08.08.2026');
index = index.replaceAll(
  'Текст является рабочей редакцией для закрытого теста и будет дополнен перед публичным запуском.',
  'Действующая редакция правил программы лояльности «ПИВНИК».'
);
index = index.replaceAll(
  'Рабочая редакция для закрытого бета-теста, версия 0.4.',
  'Действующая редакция правил программы лояльности от 08.08.2026.'
);
index = index.replaceAll(
  'Награды за 1–3 место появятся после бета-теста.',
  'Лига — информационный рейтинг по подтверждённым покупкам.'
);
index = index.replaceAll(
  '<h2 id="achievementCelebrationTitle">Тестировщик</h2>',
  '<h2 id="achievementCelebrationTitle">Пионер Пивника</h2>'
);
index = index.replaceAll(
  '<p id="achievementCelebrationDescription">Вы вошли в число первых участников закрытого бета-теста.</p>',
  '<p id="achievementCelebrationDescription">Вы вошли в число первых 30 участников «Пивника».</p>'
);
index = index.replace(/<div class="achievement-celebration-icon" id="achievementCelebrationIcon">[^<]*<\/div>/,
  '<div class="achievement-celebration-icon" id="achievementCelebrationIcon">✦</div>');
index = index.replace(/app\.js\?v=[^"']+/g, `app.js?v=${cacheVersion}`);

const buildMeta = `<meta name="pivnik-client-build" content="${buildId}" />`;
if (/<meta name="pivnik-client-build" content="[^"]*"\s*\/>/.test(index)) {
  index = index.replace(/<meta name="pivnik-client-build" content="[^"]*"\s*\/>/, buildMeta);
} else {
  index = index.replace(
    '<meta name="theme-color" content="#0b0e13" />',
    `<meta name="theme-color" content="#0b0e13" />\n  ${buildMeta}`
  );
}
await write('index.html', index);

let app = await read('app.js');
app = app.replace(new RegExp(`${syncStart}[\\s\\S]*?${syncEnd}\\n?`, 'g'), '');

const escapedBuildId = escapeForSingleQuotedJs(buildId);
app += `\n\n${syncStart}\n// ${marker}. The source HTML is sanitized at startup and the live VK client\n// reloads when Railway starts serving a different commit.\n(() => {\n  const CURRENT_BUILD = '${escapedBuildId}';\n\n  function removeLegacyPublicLabels() {\n    document.querySelectorAll('.beta-badge').forEach((element) => element.remove());\n    const replacements = new Map([\n      ['ЗАКРЫТАЯ БЕТА', ''],\n      ['закрытая бета', ''],\n      ['Правила бета-тестирования', 'Работа приложения'],\n      ['Тестировщик', 'Пионер Пивника']\n    ]);\n    document.querySelectorAll('body *').forEach((element) => {\n      if (element.children.length) return;\n      const value = String(element.textContent || '').trim();\n      if (!replacements.has(value)) return;\n      const replacement = replacements.get(value);\n      if (replacement) element.textContent = replacement;\n      else element.remove();\n    });\n  }\n\n  async function fetchServerBuild() {\n    const url = new URL(location.href);\n    url.searchParams.set('__pivnik_build_check', String(Date.now()));\n    const response = await fetch(url.toString(), {\n      method: 'GET',\n      cache: 'no-store',\n      credentials: 'same-origin',\n      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' }\n    });\n    if (!response.ok) return '';\n    const html = await response.text();\n    const match = html.match(/<meta name="pivnik-client-build" content="([^"]+)"\\s*\\/>/i);\n    return String(match?.[1] || '');\n  }\n\n  let checking = false;\n  async function reloadIfNewBuild() {\n    if (checking || document.hidden) return;\n    checking = true;\n    try {\n      const serverBuild = await fetchServerBuild();\n      if (serverBuild && serverBuild !== CURRENT_BUILD) {\n        location.reload();\n      }\n    } catch (error) {\n      console.warn('Release build check skipped:', error);\n    } finally {\n      checking = false;\n    }\n  }\n\n  function installHardRefreshButton() {\n    const button = document.getElementById('refreshButton');\n    if (!button || button.dataset.hardRefreshInstalled === '1') return;\n    button.dataset.hardRefreshInstalled = '1';\n    button.title = 'Обновить приложение';\n    button.setAttribute('aria-label', 'Обновить приложение');\n    button.addEventListener('click', (event) => {\n      event.preventDefault();\n      event.stopImmediatePropagation();\n      const url = new URL(location.href);\n      url.searchParams.set('__pivnik_reload', String(Date.now()));\n      location.replace(url.toString());\n    }, true);\n  }\n\n  function initializeReleaseSync() {\n    removeLegacyPublicLabels();\n    installHardRefreshButton();\n    window.setTimeout(() => void reloadIfNewBuild(), 4000);\n    window.setInterval(() => void reloadIfNewBuild(), 60_000);\n  }\n\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', initializeReleaseSync, { once: true });\n  } else {\n    initializeReleaseSync();\n  }\n\n  document.addEventListener('visibilitychange', () => {\n    if (!document.hidden) {\n      removeLegacyPublicLabels();\n      installHardRefreshButton();\n      void reloadIfNewBuild();\n    }\n  });\n})();\n${syncEnd}\n`;
await write('app.js', app);

let gateway = await read('universal-server.js');
gateway = gateway.replace(/app\.js\?v=[^"\\]+/g, `app.js?v=${cacheVersion}`);
await write('universal-server.js', gateway);

const finalIndex = await read('index.html');
const finalApp = await read('app.js');
const failures = [];
for (const phrase of forbidden) {
  if (finalIndex.includes(phrase)) failures.push(`index.html: ${phrase}`);
}
if (finalIndex.includes('beta-badge')) failures.push('index.html: beta-badge');
if (!finalIndex.includes(`app.js?v=${cacheVersion}`)) failures.push('index.html: cache version');
if (!finalIndex.includes(`name="pivnik-client-build" content="${buildId}"`)) failures.push('index.html: build marker');
if (!finalApp.includes(syncStart) || !finalApp.includes(syncEnd)) failures.push('app.js: release sync');
if (!finalApp.includes("dataset.hardRefreshInstalled")) failures.push('app.js: hard refresh button');
if (!finalApp.includes("__pivnik_build_check")) failures.push('app.js: release polling');
if (failures.length) {
  throw new Error(`Public no-beta guard failed: ${failures.join(', ')}`);
}

console.log(`Public no-beta guard applied. Client build: ${buildId}.`);
