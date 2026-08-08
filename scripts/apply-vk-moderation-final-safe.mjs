import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFile(path.join(root, file), content, 'utf8');

const RELEASE_DATE = '2026-08-08';
const RELEASE_MARKER = 'VK moderation final safe 2026-08-08';

function replaceAllLiteral(source, from, to) {
  return source.includes(from) ? source.split(from).join(to) : source;
}

function removePublicTestCopy(source) {
  let out = source;
  const replacements = [
    ['Награды за 1–3 место появятся после бета-теста.', 'Лига — информационный рейтинг по подтверждённым покупкам.'],
    ['Правила бета-тестирования', 'Работа приложения'],
    ['Приложение находится в режиме закрытого теста. Интерфейс, расчёты и отдельные функции могут изменяться.', 'Приложение работает как программа лояльности бара «ПИВНИК». Актуальные условия опубликованы в правилах.'],
    ['Версия документа: бета 0.4', 'Редакция правил: 08.08.2026'],
    ['Версия документа: бета', 'Редакция правил'],
    ['Рабочая редакция для закрытого бета-теста, версия 0.4.', 'Действующая редакция правил программы лояльности от 08.08.2026.'],
    ['Текст является рабочей редакцией для закрытого теста и будет дополнен перед публичным запуском.', 'Действующая редакция правил программы лояльности «ПИВНИК».'],
    ['Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».', 'Легендарное достижение первых 30 участников «Пивника».'],
    ['Легендарное достижение «Тестировщик»', 'Легендарное достижение «Пионер Пивника»'],
    ['Вы вошли в число первых участников закрытого бета-теста.', 'Вы вошли в число первых 30 участников «Пивника».'],
    ['После бета-теста: 200 бонусов после первой покупки приглашённого. Без процентов и цепочек.', 'Реферальная программа пока недоступна.'],
    ['После беты', 'Скоро'],
    ['закрытого бета-теста', 'первых участников'],
    ['закрытой беты', 'программы лояльности'],
    ['закрытая бета', ''],
    ['ЗАКРЫТАЯ БЕТА', ''],
    ['Private stock', 'Особая коллекция']
  ];
  for (const [from, to] of replacements) out = replaceAllLiteral(out, from, to);
  return out;
}

async function patchIndex() {
  let index = await read('index.html');
  index = removePublicTestCopy(index)
    .replace(/<span\s+class="beta-badge"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<h2 id="achievementCelebrationTitle">[^<]*<\/h2>/,
      '<h2 id="achievementCelebrationTitle">Пионер Пивника</h2>')
    .replace(/<p id="achievementCelebrationDescription">[^<]*<\/p>/,
      '<p id="achievementCelebrationDescription">Вы вошли в число первых 30 участников «Пивника».</p>');

  // Direct legal documents must be available before consent.
  if (!index.includes('data-final-legal-links="1"')) {
    const button = index.match(/<button\b[^>]*\bid="openTermsFromConsent"[^>]*>[\s\S]*?<\/button>/)?.[0];
    if (button) {
      index = index.replace(button, `${button}\n      <div class="consent-legal-links" data-final-legal-links="1">\n        <a class="text-link" href="/legal/terms" target="_blank" rel="noopener noreferrer">Пользовательское соглашение</a>\n        <a class="text-link" href="/legal/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a>\n        <a class="text-link" href="mailto:origtopg666@gmail.com">Поддержка</a>\n      </div>`);
    }
  }
  index = index.replace(
    /(<button\b[^>]*\bid="acceptTerms"[^>]*>)[\s\S]*?(<\/button>)/,
    '$1Подтверждаю 18+ и принимаю$2'
  );
  index = index.replace(
    /<div class="leaderboard-prize-note" id="leaderboardPrizeNote">[\s\S]*?<\/div>/,
    '<div class="leaderboard-prize-note" id="leaderboardPrizeNote">Лига — информационный рейтинг по подтверждённой сумме покупок за текущий месяц.</div>'
  );
  index = index.replaceAll('JPG, PNG или WEBP · до 6 МБ', 'JPG, PNG или WEBP · до 3 МБ');
  await write('index.html', index);
}

async function patchApp() {
  let app = await read('app.js');
  app = removePublicTestCopy(app);
  app = app.replace(
    /line\.insertAdjacentHTML\('beforeend',\s*'<span class="beta-badge">[^']*<\/span>'\);/g,
    '// Public release: test-stage badge disabled.'
  );
  app = app.replace(
    /if \(item\.icon === 'beta' \|\| item\.code === 'beta-tester'\) return '<span class="beta-achievement-icon">[^<]*<\/span>';/g,
    "if (item.icon === 'beta' || item.code === 'beta-tester') return '<span class=\"beta-achievement-icon\">✦</span>';"
  );
  await write('app.js', app);
}

async function patchVkPlatform() {
  let vk = await read('vk-platform.js');
  vk = replaceAllLiteral(vk, "eyebrow.textContent = 'VK Mini App';", "eyebrow.textContent = 'Приложение VK';");
  await write('vk-platform.js', vk);
}

function stripDeleteTermsGate(gateway) {
  return gateway.replace(
    /(if \(req\.method === 'DELETE' && url\.pathname === '\/api\/me\/account'\) \{\s*const user = await requireGatewayUser\(req\);)\s*if \(!user\.termsAccepted\) \{\s*return sendJson\(res, 428, \{ error: 'Сначала примите правила программы\.' \}\);\s*\}/,
    '$1'
  );
}

function installGlobalApiRateLimits(gateway) {
  if (gateway.includes(RELEASE_MARKER)) return gateway;
  const anchor = "    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);\n";
  if (!gateway.includes(anchor)) throw new Error('Не найден основной HTTP request handler для rate limiting.');
  const addition = `${anchor}    // ${RELEASE_MARKER}. General abuse protection required for public VK release.\n    if (url.pathname.startsWith('/api/')) {\n      enforceRateLimit(\`api-ip:\${requestAddress(req)}\`, 600, 60 * 1000);\n      const rawSession = String(req.headers.authorization || '');\n      if (rawSession.startsWith('Bearer ')) {\n        const payload = verifySession(rawSession.slice(7));\n        if (payload?.uid) enforceRateLimit(\`api-user:\${payload.uid}\`, 300, 60 * 1000);\n      }\n    }\n`;
  return gateway.replace(anchor, addition);
}

async function patchGateway() {
  let gateway = await read('universal-server.js');
  gateway = removePublicTestCopy(gateway);
  gateway = gateway.replace(/const TERMS_VERSION = '[^']+';/, `const TERMS_VERSION = '${RELEASE_DATE}';`);
  gateway = gateway.replace(/const MAX_BODY_BYTES = [^;]+;/, 'const MAX_BODY_BYTES = 4 * 1024 * 1024;');
  gateway = stripDeleteTermsGate(gateway);
  gateway = gateway.replace(
    "    || pathname === '/api/me/consent'",
    "    || pathname === '/api/me/consent'\n    || pathname === '/api/me/account'"
  );
  gateway = gateway.replaceAll(
    "prizeNote: 'После закрытия месяца участник на 1-м месте получает эпическое достижение и бесплатную пинту 0,5 л.',",
    "prizeNote: 'Лига — информационный рейтинг по подтверждённой сумме покупок за текущий месяц.',"
  );
  gateway = gateway.replaceAll("title: 'Тестировщик',", "title: 'Пионер Пивника',");
  gateway = gateway.replaceAll("'Легендарное достижение «Тестировщик»'", "'Легендарное достижение «Пионер Пивника»'");
  gateway = installGlobalApiRateLimits(gateway);
  await write('universal-server.js', gateway);
}

async function patchServer() {
  let server = await read('server.js');
  server = removePublicTestCopy(server);
  server = server.replace(/const TERMS_VERSION = '[^']+';/, `const TERMS_VERSION = '${RELEASE_DATE}';`);
  server = server.replace("app.use(express.json({ limit: '1mb' }));", "app.use(express.json({ limit: '4mb' }));");
  server = server.replaceAll("title: 'Тестировщик',", "title: 'Пионер Пивника',");

  server = server.replace(
    "{ code: 'orange-blanche-1-plus-1-3', title: 'Orange Blanche 1+1=3', description: 'Берите две Orange Blanche — третью пинту получите в подарок. Условия и наличие уточняйте у сотрудника бара.', badge: '1+1=3', active: true, sortOrder: 15 }",
    "{ code: 'orange-blanche-1-plus-1-3', title: 'Orange Blanche 1+1=3', description: '18+. При покупке двух участвующих пинт Orange Blanche третья предоставляется в подарок. Получение только лично в баре после проверки возраста. Условия и наличие уточняйте у сотрудника.', badge: '1+1=3', active: true, sortOrder: 15 }"
  );
  server = server.replace(
    "{ code: 'beer-15', title: 'Каждый 15-й литр — подарок', description: 'Оплатите 14 литров разливного пива и получите 1 литр бесплатно.', badge: '14 → 1', active: true, sortOrder: 20 }",
    "{ code: 'beer-15', title: 'Каждый 15-й литр — подарок', description: '18+. После оплаты 14 литров участвующего разливного пива предоставляется 1 подарочный литр. Получение только лично в баре после проверки возраста.', badge: '14 → 1', active: true, sortOrder: 20 }"
  );

  // Remove all public profile/digital items, not only the three historical codes.
  server = server.replace(
    "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond')",
    "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond') OR category = 'profile'"
  );
  await write('server.js', server);
}

await patchIndex();
await patchApp();
await patchVkPlatform();
await patchGateway();
await patchServer();

// Independent final assertions: fail the build instead of publishing a half-patched app.
const [index, app, vk, gateway, server, terms, privacy] = await Promise.all([
  read('index.html'), read('app.js'), read('vk-platform.js'), read('universal-server.js'),
  read('server.js'), read('legal/terms.html'), read('legal/privacy.html')
]);

const failures = [];
const requireText = (content, text, label) => { if (!content.includes(text)) failures.push(label); };
const forbid = (content, pattern, label) => { if (pattern.test(content)) failures.push(label); };

forbid(index, /закрытая\s+бета|правила\s+бета-тестирования|версия документа:\s*бета|после\s+бета-теста/i, 'public beta/test copy');
forbid(index, /class="beta-badge"/i, 'public beta badge');
requireText(index, '/legal/terms', 'terms link before consent');
requireText(index, '/legal/privacy', 'privacy link before consent');
requireText(index, 'mailto:origtopg666@gmail.com', 'support link');
requireText(index, 'Подтверждаю 18+ и принимаю', 'explicit 18+ consent');
requireText(index, 'Лига — информационный рейтинг', 'informational league copy');
requireText(index, 'до 3 МБ', 'upload UI limit');

requireText(vk, "bridge.send('VKWebAppInit')", 'VK Bridge init');
requireText(vk, 'bridge.subscribe', 'VK Bridge lifecycle subscribe');
requireText(vk, 'VKWebAppViewHide', 'VK ViewHide');
requireText(vk, 'VKWebAppViewRestore', 'VK ViewRestore');
requireText(vk, 'VKWebAppUpdateConfig', 'VK UpdateConfig');
forbid(vk, /VKWebAppGetPhoneNumber|VKWebAppGetEmail|VKWebAppGetGeodata/, 'unneeded sensitive VK Bridge method');

requireText(gateway, `const TERMS_VERSION = '${RELEASE_DATE}';`, 'gateway terms version');
requireText(server, `const TERMS_VERSION = '${RELEASE_DATE}';`, 'server terms version');
requireText(gateway, 'MAX_BODY_BYTES = 4 * 1024 * 1024', 'gateway payload limit');
requireText(server, "express.json({ limit: '4mb' })", 'server payload limit');
requireText(gateway, 'api-ip:', 'global IP rate limit');
requireText(gateway, 'api-user:', 'global user rate limit');
requireText(gateway, 'auth-invalid:', 'invalid auth rate limit');
requireText(gateway, 'enforceRateLimit(`qr:', 'QR rate limit');
requireText(gateway, 'enforceRateLimit(`pin:', 'PIN rate limit');
requireText(server, 'request_key TEXT UNIQUE', 'idempotency unique request key');

const deleteRoute = gateway.match(/if \(req\.method === 'DELETE' && url\.pathname === '\/api\/me\/account'\) \{([\s\S]*?)\n    \}/)?.[1] || '';
if (!deleteRoute || deleteRoute.includes('termsAccepted')) failures.push('delete account before consent');
requireText(gateway, 'DELETE FROM user_identities', 'identity deletion');
requireText(gateway, 'deleted_at = NOW()', 'user anonymization/deletion marker');

forbid(gateway, /получает эпическое достижение и бесплатную пинту/i, 'unruled League prize API');
forbid(server, /category:\s*'profile'[\s\S]{0,180}active:\s*true/i, 'active public digital profile item source');
requireText(server, "OR category = 'profile'", 'profile shop cleanup');
requireText(server, '18+. При покупке двух участвующих пинт Orange Blanche', 'Orange Blanche 18+ conditions');
requireText(server, '18+. После оплаты 14 литров', '15th liter 18+ conditions');

requireText(terms, 'Возрастное ограничение: 18+', '18+ in terms');
requireText(terms, 'не позднее 7 дней', 'support SLA in terms');
requireText(terms, 'не осуществляет дистанционную продажу', 'no remote alcohol sale in terms');
requireText(privacy, 'Возрастное ограничение: 18+', '18+ in privacy');
requireText(privacy, 'не продаются рекламодателям', 'privacy no data sale');

if (failures.length) {
  console.error('VK FINAL MODERATION SAFE PASS: FAIL');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('VK FINAL MODERATION SAFE PASS: PASS');
