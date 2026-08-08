import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_VERSION = '17.4-public-release';

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function write(relativePath, content) {
  await fs.writeFile(path.join(root, relativePath), content, 'utf8');
}

function replaceAll(source, from, to) {
  return source.includes(from) ? source.split(from).join(to) : source;
}

function stripPublicBetaCopy(source) {
  let result = source;
  const replacements = [
    ['Награды за 1–3 место появятся после бета-теста.', 'Награды за 1–3 место публикуются в условиях текущего сезона.'],
    ['Правила бета-тестирования', 'Работа приложения'],
    ['Приложение находится в режиме закрытого теста. Интерфейс, расчёты и отдельные функции могут изменяться.', 'Приложение работает как программа лояльности бара «ПИВНИК». Актуальные условия бонусной программы опубликованы в правилах.'],
    ['Возможны временные ошибки, задержки обновления данных и недоступность отдельных разделов. О найденных проблемах нужно сообщать владельцу или сотруднику.', 'При технической ошибке или задержке обновления данных обратитесь к сотруднику бара.'],
    ['Планируется сохранить бонусы и статусы, накопленные в бета-тесте, если до завершения теста не будет объявлено иное.', 'Бонусы, статусы и история операций сохраняются в профиле согласно действующим правилам программы.'],
    ['Версия документа: бета 0.4', 'Редакция правил: 07.08.2026'],
    ['Текст является рабочей редакцией для закрытого теста и будет дополнен перед публичным запуском.', 'Действующая редакция правил программы лояльности «ПИВНИК».'],
    ['Рабочая редакция для закрытого бета-теста, версия 0.4.', 'Действующая редакция правил программы лояльности от 07.08.2026.'],
    ['Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».', 'Легендарное достижение первых 30 участников «Пивника».'],
    ['Легендарное достижение «Тестировщик»', 'Легендарное достижение «Пионер Пивника»'],
    ['После бета-теста: 200 бонусов после первой покупки приглашённого. Без процентов и цепочек.', 'Реферальная программа пока недоступна.'],
    ['После беты', 'Скоро'],
    ['закрытого бета-теста', 'первых участников'],
    ['закрытой беты', 'программы лояльности']
  ];
  for (const [from, to] of replacements) result = replaceAll(result, from, to);
  return result;
}

let index = await read('index.html');
index = stripPublicBetaCopy(index);
index = index.replace(/<span\s+class="beta-badge"[^>]*>[^<]*<\/span>/gi, '');
index = index.replace(
  /<div class="achievement-celebration-icon" id="achievementCelebrationIcon">[^<]*<\/div>/,
  '<div class="achievement-celebration-icon" id="achievementCelebrationIcon">✦</div>'
);
index = index.replace(
  /<h2 id="achievementCelebrationTitle">[^<]*<\/h2>/,
  '<h2 id="achievementCelebrationTitle">Пионер Пивника</h2>'
);
index = index.replace(
  /<p id="achievementCelebrationDescription">[^<]*<\/p>/,
  '<p id="achievementCelebrationDescription">Вы вошли в число первых 30 участников «Пивника».</p>'
);
index = index.replace(/styles\.css\?v=[^"']+/g, `styles.css?v=${RELEASE_VERSION}`);
index = index.replace(/app\.js\?v=[^"']+/g, `app.js?v=${RELEASE_VERSION}`);
if (!index.includes('name="pivnik-release"')) {
  index = index.replace(
    '<meta name="theme-color" content="#0b0e13" />',
    `<meta name="theme-color" content="#0b0e13" />\n  <meta name="pivnik-release" content="${RELEASE_VERSION}" />`
  );
}
await write('index.html', index);

let app = await read('app.js');
app = stripPublicBetaCopy(app);
app = app.replace(
  /line\.insertAdjacentHTML\('beforeend',\s*'<span class="beta-badge">[^']*<\/span>'\);/g,
  '// Public release: beta/test badge intentionally disabled.'
);
app = app.replace(
  /if \(item\.icon === 'beta' \|\| item\.code === 'beta-tester'\) return '<span class="beta-achievement-icon">[^<]*<\/span>';/g,
  "if (item.icon === 'beta' || item.code === 'beta-tester') return '<span class=\"beta-achievement-icon\">✦</span>';"
);
if (!app.includes('const publicReleaseLabel = (value) =>')) {
  const marker = "const roleCanWrite = (role) => role === 'admin';\n";
  const helper = `${marker}const publicReleaseLabel = (value) => stripPublicReleaseText(String(value ?? ''));\nconst stripPublicReleaseText = (value) => String(value ?? '')\n  .replaceAll('Легендарное достижение «Тестировщик»', 'Легендарное достижение «Пионер Пивника»')\n  .replaceAll('закрытого бета-теста', 'первых участников')\n  .replaceAll('закрытой беты', 'программы лояльности')\n  .replaceAll('После беты', 'Скоро');\n`;
  if (!app.includes(marker)) throw new Error('Не найдено место для publicReleaseLabel.');
  app = app.replace(marker, helper);
}
app = app.replaceAll('transaction.reason ||', 'publicReleaseLabel(transaction.reason) ||');
await write('app.js', app);

for (const serverFile of ['universal-server.js', 'server.js']) {
  let server = await read(serverFile);
  server = stripPublicBetaCopy(server);
  server = replaceAll(server, "title: 'Тестировщик',", "title: 'Пионер Пивника',");
  server = replaceAll(server, "description: 'Легендарное достижение первых 30 участников «Пивника».',", "description: 'Легендарное достижение первых 30 участников «Пивника».',");
  await write(serverFile, server);
}

const accountLinkPath = path.join(root, 'account-link.js');
try {
  let accountLink = await fs.readFile(accountLinkPath, 'utf8');
  accountLink = stripPublicBetaCopy(accountLink);
  await fs.writeFile(accountLinkPath, accountLink, 'utf8');
} catch {}

const publicFiles = [
  ['index.html', index],
  ['app.js', app],
  ['universal-server.js', await read('universal-server.js')],
  ['server.js', await read('server.js')]
];

const forbiddenVisiblePhrases = [
  'закрытая бета',
  'закрытого бета-теста',
  'закрытой беты',
  'после бета-теста',
  'правила бета-тестирования',
  'режиме закрытого теста',
  'накопленные в бета-тесте',
  'версия документа: бета',
  'рабочей редакцией для закрытого теста',
  'рабочая редакция для закрытого бета-теста',
  'перед публичным запуском',
  '>тестировщик</h2>'
];
const failures = [];
for (const [name, content] of publicFiles) {
  const lower = content.toLowerCase();
  for (const phrase of forbiddenVisiblePhrases) {
    if (lower.includes(phrase)) failures.push(`${name}: ${phrase}`);
  }
}
if (index.includes('class="beta-badge"')) failures.push('index.html: beta badge element');
if (!index.includes(`name="pivnik-release" content="${RELEASE_VERSION}"`)) failures.push('index.html: release marker missing');
if (!index.includes(`styles.css?v=${RELEASE_VERSION}`)) failures.push('index.html: styles cache version');
if (!index.includes(`app.js?v=${RELEASE_VERSION}`)) failures.push('index.html: app cache version');

if (failures.length) {
  throw new Error(`Public release verification failed: ${failures.join('; ')}`);
}

console.log(`Public release ${RELEASE_VERSION} verified: beta/test/demo copy is absent from the public UI.`);
