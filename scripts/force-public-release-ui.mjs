import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_VERSION = '17.6-no-beta-20260808';

const read = (file) => fs.readFile(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFile(path.join(root, file), content, 'utf8');
const replaceAll = (source, from, to) => source.includes(from) ? source.split(from).join(to) : source;

const publicCopyReplacements = [
  ['Награды за 1–3 место появятся после бета-теста.', 'Лига — информационный рейтинг по подтверждённой сумме покупок за текущий месяц.'],
  ['Правила бета-тестирования', 'Работа приложения'],
  ['Приложение находится в режиме закрытого теста. Интерфейс, расчёты и отдельные функции могут изменяться.', 'Приложение работает как программа лояльности бара «ПИВНИК». Актуальные условия опубликованы в правилах.'],
  ['Возможны временные ошибки, задержки обновления данных и недоступность отдельных разделов. О найденных проблемах нужно сообщать владельцу или сотруднику.', 'При технической ошибке или задержке обновления данных обратитесь к сотруднику бара.'],
  ['Планируется сохранить бонусы и статусы, накопленные в бета-тесте, если до завершения теста не будет объявлено иное.', 'Бонусы, статусы и история операций сохраняются в профиле согласно действующим правилам программы.'],
  ['Версия документа: бета 0.4', 'Редакция правил: 08.08.2026'],
  ['Текст является рабочей редакцией для закрытого теста и будет дополнен перед публичным запуском.', 'Действующая редакция правил программы лояльности «ПИВНИК».'],
  ['Рабочая редакция для закрытого бета-теста, версия 0.4.', 'Действующая редакция правил программы лояльности от 08.08.2026.'],
  ['Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».', 'Легендарное достижение первых 30 участников «Пивника».'],
  ['Легендарное достижение «Тестировщик»', 'Легендарное достижение «Пионер Пивника»'],
  ['Вы вошли в число первых участников закрытого бета-теста.', 'Вы вошли в число первых 30 участников «Пивника».'],
  ['После бета-теста: 200 бонусов после первой покупки приглашённого. Без процентов и цепочек.', 'Реферальная программа пока недоступна.'],
  ['После беты', 'Скоро'],
  ['закрытая бета', ''],
  ['ЗАКРЫТАЯ БЕТА', '']
];

function sanitizePublicCopy(source) {
  let out = source;
  for (const [from, to] of publicCopyReplacements) out = replaceAll(out, from, to);
  return out;
}

let index = sanitizePublicCopy(await read('index.html'));
index = index.replace(/<span\s+class=["']beta-badge["'][^>]*>[\s\S]*?<\/span>/gi, '');
index = index.replace(/styles\.css\?v=[^"']+/g, `styles.css?v=${RELEASE_VERSION}`);
index = index.replace(/app\.js\?v=[^"']+/g, `app.js?v=${RELEASE_VERSION}`);
index = index.replace(/<div class=["']achievement-cebration-icon["'] id=["']achievementCelebrationIcon["']>[^<]*<\/div>/, '<div class="achievement-celebration-icon" id="achievementCelebrationIcon">✦</div>');
index = index.replace(/<h2 id=["']achievementCelebrationTitle["']>[^<]*<\/h2>/, '<h2 id="achievementCelebrationTitle">Пионер Пивника</h2>');
index = index.replace(/<p id=["']achievementCelebrationDescription["']>[^<]*<\/p>/, '<p id="achievementCelebrationDescription">Вы вошли в число первых 30 участников «Пивника».</p>');
await write('index.html', index);

let app = sanitizePublicCopy(await read('app.js'));
app = app.replace(/line\.insertAdjacentHTML\(\s*['"]beforeend['"]\s*,\s*['"]<span class=\\?["']beta-badge\\?["'][\s\S]*?<\\?\/span>['"]\s*\);?/g, '// Public release: legacy stage badge removed.');
app = app.replace(/const APP_VERSION = '[^']+';/, `const APP_VERSION = '${RELEASE_VERSION}';`);
app = app.replace(/if \(item\.icon === 'beta' \|\| item\.code === 'beta-tester'\) return '<span class="beta-achievement-icon">[^<]*<\/span>';/g, "if (item.icon === 'beta' || item.code === 'beta-tester') return '<span class=\"beta-achievement-icon\">✦</span>';" );
if (!app.includes('FINAL_PUBLIC_RELEASE_UI_GUARD_20260808')) {
  app += `\n\n// FINAL_PUBLIC_RELEASE_UI_GUARD_20260808\nfunction scrubLegacyStageUi(root = document) {\n  root.querySelectorAll?.('.beta-badge').forEach((node) => node.remove());\n  const replacements = new Map([\n    ['закрытая бета', ''],\n    ['ЗАКРЫТАЯ БЕТА', ''],\n    ['Правила бета-тестирования', 'Работа приложения'],\n    ['Версия документа: бета 0.4', 'Редакция правил: 08.08.2026'],\n    ['Награды за 1–3 место появятся после бета-теста.', 'Лига — информационный рейтинг по подтверждённой сумме покупок за текущий месяц.'],\n    ['Тестировщик', 'Пионер Пивника'],\n    ['Вы вошли в число первых участников закрытого бета-теста.', 'Вы вошли в число первых 30 участников «Пивника».']\n  ]);\n  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);\n  for (let node = walker.nextNode(); node; node = walker.nextNode()) {\n    let text = node.nodeValue || '';\n    for (const [from, to] of replacements) text = text.split(from).join(to);\n    if (text !== node.nodeValue) node.nodeValue = text;\n  }\n}\ndocument.addEventListener('DOMContentLoaded', () => {\n  scrubLegacyStageUi(document);\n  new MutationObserver(() => scrubLegacyStageUi(document)).observe(document.body, { childList: true, subtree: true, characterData: true });\n});\n`;
}
await write('app.js', app);

for (const file of ['universal-server.js', 'server.js']) {
  let source = sanitizePublicCopy(await read(file));
  source = source.replace(/const TERMS_VERSION = 'beta-0\.4';/, "const TERMS_VERSION = '2026-08-08';");
  source = replaceAll(source, "title: 'Тестировщик',", "title: 'Пионер Пивника',");
  source = replaceAll(source, "description: 'Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».',", "description: 'Легендарное достижение первых 30 участников «Пивника».',");
  await write(file, source);
}

const finalIndex = await read('index.html');
const finalApp = await read('app.js');
const forbidden = [/закрытая\s+бета/i,/правила\s+бета-тестирования/i,/версия документа:\s*бета/i,/после\s+бета-теста/i,/режиме\s+закрытого\s+теста/i,/class=["']beta-badge["']/i,/insertAdjacentHTML\([^\n]*beta-badge/i];
const failures = [];
for (const pattern of forbidden) {
  if (pattern.test(finalIndex)) failures.push(`index.html:${pattern}`);
  if (pattern.test(finalApp)) failures.push(`app.js:${pattern}`);
}
if (!finalIndex.includes(`app.js?v=${RELEASE_VERSION}`)) failures.push('index.html: app cache version not updated');
if (!finalIndex.includes(`styles.css?v=${RELEASE_VERSION}`)) failures.push('index.html: styles cache version not updated');
if (!finalApp.includes(`const APP_VERSION = '${RELEASE_VERSION}';`)) failures.push('app.js: release version not updated');
if (failures.length) throw new Error(`FINAL PUBLIC RELEASE UI GUARD FAILED: ${failures.join('; ')}`);
console.log(`FINAL PUBLIC RELEASE UI GUARD OK: ${RELEASE_VERSION}; legacy beta/test UI is absent.`);
