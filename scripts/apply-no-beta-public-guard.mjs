import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = 'Public no-beta guard 2026-08-08';
const cacheVersion = '3.4.0-no-beta-public';
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

let index = await read('index.html');
index = index.replace(/<span class="beta-badge">[\s\S]*?<\/span>/gi, '');
index = index.replaceAll('Правила бета-тестирования', 'Работа приложения');
index = index.replaceAll(
  'Приложение находится в режиме закрытого теста. Интерфейс, расчёты и отдельные функции могут изменяться.',
  'Приложение работает как программа лояльности бара «ПИВНИК». Актуальные условия опубликованы в правилах.'
);
index = index.replaceAll('Версия документа: бета 0.4', 'Редакция правил: 08.08.2026');
index = index.replaceAll(
  'Рабочая редакция для закрытого бета-теста, версия 0.4.',
  'Действующая редакция правил программы лояльности.'
);
index = index.replaceAll(
  'Награды за 1–3 место появятся после бета-теста.',
  'Лига — информационный рейтинг по подтверждённым покупкам.'
);
index = index.replaceAll(
  '<h2 id="achievementCelebrationTitle">Тестировщик</h2>',
  '<h2 id="achievementCelebrationTitle">Пионер Пивника</h2>'
);
index = index.replace(/app\.js\?v=[^"']+/g, `app.js?v=${cacheVersion}`);
await write('index.html', index);

let app = await read('app.js');
if (!app.includes(marker)) {
  app += `\n\n// ${marker}. Defense against stale VK WebView markup.\ndocument.addEventListener('DOMContentLoaded', () => {\n  document.querySelectorAll('.beta-badge').forEach((element) => element.remove());\n  const replacements = new Map([\n    ['ЗАКРЫТАЯ БЕТА', ''],\n    ['закрытая бета', ''],\n    ['Правила бета-тестирования', 'Работа приложения'],\n    ['Тестировщик', 'Пионер Пивника']\n  ]);\n  document.querySelectorAll('body *').forEach((element) => {\n    if (element.children.length) return;\n    const value = String(element.textContent || '').trim();\n    if (!replacements.has(value)) return;\n    const replacement = replacements.get(value);\n    if (replacement) element.textContent = replacement;\n    else element.remove();\n  });\n});\n`;
}
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
if (!finalApp.includes(marker)) failures.push('app.js: stale WebView cleanup');
if (failures.length) {
  throw new Error(`Public no-beta guard failed: ${failures.join(', ')}`);
}

console.log('Public no-beta guard applied and verified.');
