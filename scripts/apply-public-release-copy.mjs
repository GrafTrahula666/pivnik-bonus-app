import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function write(relativePath, content) {
  await fs.writeFile(path.join(root, relativePath), content, 'utf8');
}

function replaceAll(source, from, to) {
  return source.includes(from) ? source.split(from).join(to) : source;
}

let index = await read('index.html');
const indexReplacements = [
  [
    '<div class="brand-line"><h1 id="brandTitle">Пивник</h1><span class="beta-badge">закрытая бета</span></div>',
    '<div class="brand-line"><h1 id="brandTitle">Пивник</h1></div>'
  ],
  [
    'Награды за 1–3 место появятся после бета-теста.',
    'Награды за 1–3 место публикуются в условиях текущего сезона.'
  ],
  [
    'Административный доступ ограничивается ролями. Полные юридические реквизиты оператора и сроки хранения данных должны быть опубликованы перед открытым запуском.',
    'Административный доступ ограничивается ролями. Юридические сведения и условия обработки данных опубликованы в правилах и политике конфиденциальности.'
  ],
  ['Правила бета-тестирования', 'Работа приложения'],
  [
    'Приложение находится в режиме закрытого теста. Интерфейс, расчёты и отдельные функции могут изменяться.',
    'Приложение работает как программа лояльности бара «ПИВНИК». Актуальные условия бонусной программы опубликованы в правилах.'
  ],
  [
    'Возможны временные ошибки, задержки обновления данных и недоступность отдельных разделов. О найденных проблемах нужно сообщать владельцу или сотруднику.',
    'При технической ошибке или задержке обновления данных обратитесь к сотруднику бара.'
  ],
  [
    'Планируется сохранить бонусы и статусы, накопленные в бета-тесте, если до завершения теста не будет объявлено иное.',
    'Бонусы, статусы и история операций сохраняются в профиле согласно действующим правилам программы.'
  ],
  ['Версия документа: бета 0.4', 'Редакция правил: 07.08.2026'],
  [
    'Текст является рабочей редакцией для закрытого теста и будет дополнен перед публичным запуском.',
    'Действующая редакция правил программы лояльности «ПИВНИК».'
  ],
  [
    '<div class="achievement-celebration-icon" id="achievementCelebrationIcon">β</div>',
    '<div class="achievement-celebration-icon" id="achievementCelebrationIcon">✦</div>'
  ],
  ['<h2 id="achievementCelebrationTitle">Тестировщик</h2>', '<h2 id="achievementCelebrationTitle">Пионер Пивника</h2>'],
  [
    '<p id="achievementCelebrationDescription">Вы вошли в число первых участников закрытого бета-теста.</p>',
    '<p id="achievementCelebrationDescription">Вы вошли в число первых 30 участников «Пивника».</p>'
  ],
  [
    '<small>Рабочая редакция для закрытого бета-теста, версия 0.4.</small>',
    '<small>Действующая редакция правил программы лояльности от 07.08.2026.</small>'
  ]
];
for (const [from, to] of indexReplacements) index = replaceAll(index, from, to);
await write('index.html', index);

let app = await read('app.js');
app = replaceAll(
  app,
  "        line.insertAdjacentHTML('beforeend', '<span class=\"beta-badge\">закрытая бета</span>');",
  '        // Public release: no beta/test badge in the interface.'
);
app = replaceAll(
  app,
  "if (item.icon === 'beta' || item.code === 'beta-tester') return '<span class=\"beta-achievement-icon\">β</span>';",
  "if (item.icon === 'beta' || item.code === 'beta-tester') return '<span class=\"beta-achievement-icon\">✦</span>';"
);
if (!app.includes('const publicReleaseLabel = (value) =>')) {
  const marker = "const roleCanWrite = (role) => role === 'admin';\n";
  const helper = `${marker}const publicReleaseLabel = (value) => String(value ?? '')\n  .replaceAll('Легендарное достижение «Тестировщик»', 'Легендарное достижение «Пионер Пивника»')\n  .replaceAll('закрытого бета-теста', 'первых участников')\n  .replaceAll('закрытой беты', 'программы лояльности');\n`;
  if (!app.includes(marker)) throw new Error('Не найдено место для publicReleaseLabel.');
  app = app.replace(marker, helper);
}
app = app.replaceAll('transaction.reason ||', 'publicReleaseLabel(transaction.reason) ||');
await write('app.js', app);

for (const serverFile of ['universal-server.js', 'server.js']) {
  let server = await read(serverFile);
  server = replaceAll(server, "title: 'Тестировщик',", "title: 'Пионер Пивника',");
  server = replaceAll(
    server,
    "description: 'Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».',",
    "description: 'Легендарное достижение первых 30 участников «Пивника».',"
  );
  server = replaceAll(
    server,
    "'Легендарное достижение «Тестировщик»',\n        'adjustment'",
    "'Легендарное достижение «Пионер Пивника»',\n        'adjustment'"
  );
  server = replaceAll(
    server,
    "'Легендарное достижение «Тестировщик»',\n      'adjustment'",
    "'Легендарное достижение «Пионер Пивника»',\n      'adjustment'"
  );
  server = replaceAll(
    server,
    "description: 'После бета-теста: 200 бонусов после первой покупки приглашённого. Без процентов и цепочек.', badge: 'После беты'",
    "description: 'Реферальная программа пока недоступна.', badge: 'Скоро'"
  );
  await write(serverFile, server);
}

const forbiddenIndex = [
  'закрытая бета',
  'после бета-теста',
  'Правила бета-тестирования',
  'режиме закрытого теста',
  'накопленные в бета-тесте',
  'Версия документа: бета',
  'рабочей редакцией для закрытого теста',
  'перед публичным запуском',
  '>Тестировщик</h2>',
  '>β</div>',
  'Рабочая редакция для закрытого бета-теста'
];
const forbiddenApp = [
  'beta-badge\">закрытая бета',
  'beta-achievement-icon\">β'
];
const failures = [];
for (const phrase of forbiddenIndex) if (index.includes(phrase)) failures.push(`index.html: ${phrase}`);
for (const phrase of forbiddenApp) if (app.includes(phrase)) failures.push(`app.js: ${phrase}`);
if (failures.length) throw new Error(`Публичные beta/test-метки остались: ${failures.join(', ')}`);

console.log('Public release copy is applied: beta/test/demo labels are absent from the user interface.');
