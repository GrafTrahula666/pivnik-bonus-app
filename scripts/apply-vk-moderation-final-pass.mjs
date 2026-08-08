import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const termsVersion = '2026-08-08';
const supportEmail = 'origtopg666@gmail.com';
const marker = 'VK final moderation compliance 2026-08-08';

const read = (name) => fs.readFile(path.join(root, name), 'utf8');
const write = (name, value) => fs.writeFile(path.join(root, name), value, 'utf8');
const all = (source, from, to) => source.includes(from) ? source.split(from).join(to) : source;

let index = await read('index.html');
index = index
  .replace(/<span\s+class="beta-badge"[^>]*>[\s\S]*?<\/span>/gi, '')
  .replaceAll('закрытая бета', '')
  .replaceAll('ЗАКРЫТАЯ БЕТА', '')
  .replaceAll('Правила бета-тестирования', 'Работа приложения')
  .replaceAll('Версия документа: бета 0.4', 'Редакция правил: 08.08.2026')
  .replaceAll('Рабочая редакция для закрытого бета-теста, версия 0.4.', 'Действующая редакция правил программы лояльности от 08.08.2026.')
  .replaceAll('Тестировщик', 'Пионер Пивника')
  .replaceAll('Вы вошли в число первых участников закрытого бета-теста.', 'Вы вошли в число первых 30 участников «Пивника».')
  .replaceAll('JPG, PNG или WEBP · до 6 МБ', 'JPG, PNG или WEBP · до 3 МБ')
  .replaceAll('Крафт, лимитированные бокалы и оформление профиля — с выдачей прямо в баре.', 'Физические товары, лимитированные бокалы и награды — с получением лично в баре.')
  .replaceAll('◆ Безопасная покупка по QR', '◆ Получение по QR в баре')
  .replaceAll('Каталог разделён по категориям. Товары за бонусы выдаёт сотрудник по QR, рублёвые позиции оплачиваются в баре.', 'Каталог физических товаров и наград. Получение происходит лично в баре по правилам программы лояльности.');
index = index.replace(/<div class="achievement-celebration-icon" id="achievementCelebrationIcon">[^<]*<\/div>/,
  '<div class="achievement-celebration-icon" id="achievementCelebrationIcon">✦</div>');
index = index.replace(/<div class="leaderboard-prize-note" id="leaderboardPrizeNote">[\s\S]*?<\/div>/,
  '<div class="leaderboard-prize-note" id="leaderboardPrizeNote">Лига — информационный рейтинг по подтверждённым покупкам. Призовые сезоны проводятся только при заранее опубликованных отдельных правилах.</div>');
index = index.replace(/(<button\b[^>]*\bid="acceptTerms"[^>]*>)[\s\S]*?(<\/button>)/,
  '$1Подтверждаю 18+ и принимаю$2');

if (!index.includes('href="/legal/terms"')) {
  index = index.replace(
    /(<button\b[^>]*\bid="openTermsFromConsent"[^>]*>[\s\S]*?<\/button>)/,
    `$1\n      <div class="consent-legal-links" data-final-moderation="${marker}">\n        <a class="text-link" href="/legal/terms" target="_blank" rel="noopener noreferrer">Пользовательское соглашение</a>\n        <a class="text-link" href="/legal/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a>\n        <a class="text-link" href="mailto:${supportEmail}">Поддержка: ${supportEmail}</a>\n      </div>`
  );
}
await write('index.html', index);

let gateway = await read('universal-server.js');
gateway = gateway.replace(/const TERMS_VERSION = '[^']+';/, `const TERMS_VERSION = '${termsVersion}';`);
gateway = gateway.replace(/const MAX_BODY_BYTES = [^;]+;/, 'const MAX_BODY_BYTES = 4 * 1024 * 1024;');

if (!gateway.includes("|| pathname === '/api/me/account'")) {
  gateway = gateway.replace(
    "    || pathname === '/api/me/consent'",
    "    || pathname === '/api/me/consent'\n    || pathname === '/api/me/account'"
  );
}

const deleteStart = gateway.indexOf("    if (req.method === 'DELETE' && url.pathname === '/api/me/account') {");
const deleteEnd = deleteStart >= 0
  ? gateway.indexOf("    if (req.method === 'GET' && url.pathname === '/api/leaderboard/monthly') {", deleteStart)
  : -1;
if (deleteStart >= 0 && deleteEnd > deleteStart) {
  let region = gateway.slice(deleteStart, deleteEnd);
  region = region.replace(
    /\n\s*if \(!user\.termsAccepted\) \{\n\s*return sendJson\(res, 428, \{ error: 'Сначала примите правила программы\.' \}\);\n\s*\}\n/,
    '\n'
  );
  if (!region.includes('delete-account:')) {
    region = region.replace(
      '      const user = await requireGatewayUser(req);',
      '      const user = await requireGatewayUser(req);\n      enforceRateLimit(`delete-account:${user.id}:${requestAddress(req)}`, 5, 10 * 60 * 1000);'
    );
  }
  gateway = `${gateway.slice(0, deleteStart)}${region}${gateway.slice(deleteEnd)}`;
} else {
  console.warn('VK final moderation: delete route region was not found; release gate will verify it separately.');
}

if (!gateway.includes(`// ${marker}: general API abuse protection`)) {
  const anchor = "    if (url.pathname.startsWith('/api/')) enforceMutationOrigin(req);";
  if (gateway.includes(anchor)) {
    gateway = gateway.replace(
      anchor,
      `${anchor}\n\n    // ${marker}: general API abuse protection\n    if (url.pathname.startsWith('/api/')) {\n      enforceRateLimit(\`api-ip:\${requestAddress(req)}\`, 300, 60 * 1000);\n      if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) {\n        const authHeader = String(req.headers.authorization || '');\n        if (authHeader.startsWith('Bearer ')) {\n          const sessionBucket = crypto.createHash('sha256').update(authHeader).digest('hex').slice(0, 24);\n          enforceRateLimit(\`api-session:\${sessionBucket}\`, 120, 60 * 1000);\n        }\n      }\n    }`
    );
  } else {
    console.warn('VK final moderation: API origin anchor was not found; release gate will verify rate limiting separately.');
  }
}
gateway = all(gateway, "title: 'Тестировщик',", "title: 'Пионер Пивника',");
gateway = all(gateway, 'Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».', 'Легендарное достижение первых 30 участников «Пивника».');
await write('universal-server.js', gateway);

let server = await read('server.js');
server = server.replace(/const TERMS_VERSION = '[^']+';/, `const TERMS_VERSION = '${termsVersion}';`);
server = server.replace("app.use(express.json({ limit: '1mb' }));", "app.use(express.json({ limit: '4mb' }));");
server = all(server, "title: 'Тестировщик',", "title: 'Пионер Пивника',");
server = all(server, 'Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».', 'Легендарное достижение первых 30 участников «Пивника».');
server = all(server, 'Легендарное достижение «Тестировщик»', 'Легендарное достижение «Пионер Пивника»');
server = all(server, 'Бета-тест — Старшина Анна Берман', 'Персональная награда — Старшина Анна Берман');
server = all(server, 'После бета-теста: 200 бонусов после первой покупки приглашённого. Без процентов и цепочек.', 'Реферальная программа пока недоступна.');
server = all(server, "badge: 'После беты'", "badge: 'Скоро'");
server = all(server,
  "description: 'Берите две Orange Blanche — третью пинту получите в подарок. Условия и наличие уточняйте у сотрудника бара.'",
  "description: '18+. При покупке двух участвующих пинт Orange Blanche третья предоставляется в подарок. Получение только лично в баре при наличии; условия уточняйте у сотрудника до оплаты.'");
server = all(server,
  "description: 'Оплатите 14 литров разливного пива и получите 1 литр бесплатно.'",
  "description: '18+. После оплаты 14 литров участвующего разливного пива следующий 1 литр предоставляется в подарок. Получение только лично в баре после проверки возраста.'");
server = all(server,
  "prizeNote: 'После закрытия месяца участник на 1-м месте получает эпическое достижение и бесплатную пинту 0,5 л.'",
  "prizeNote: 'Лига является информационным рейтингом. Призы действуют только в сезонах с заранее опубликованными отдельными правилами.'");
server = all(server,
  "SELECT * FROM shop_items ORDER BY sort_order, id",
  "SELECT * FROM shop_items WHERE category <> 'profile' ORDER BY sort_order, id");
server = all(server,
  "note: 'Каталог разделён по категориям. Товары за бонусы выдаёт сотрудник по QR, рублёвые позиции оплачиваются в баре.'",
  "note: 'Каталог физических товаров и наград. Получение происходит лично в баре по правилам программы лояльности.'");
server = server.replace(
  "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond')",
  "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond') OR category = 'profile'"
);
await write('server.js', server);

console.log('VK final moderation compliance pass applied idempotently.');
