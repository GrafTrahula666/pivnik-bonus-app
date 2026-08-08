import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = 'VK final moderation compliance 2026-08-08';
const termsVersion = '2026-08-08';
const supportEmail = 'origtopg666@gmail.com';

async function read(name) {
  return fs.readFile(path.join(root, name), 'utf8');
}

async function write(name, value) {
  await fs.writeFile(path.join(root, name), value, 'utf8');
}

function replaceAll(source, from, to) {
  return source.includes(from) ? source.split(from).join(to) : source;
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Не найден final-moderation фрагмент: ${label}`);
  return source.replace(from, to);
}

function replaceRegion(source, startText, endText, transform, label) {
  const start = source.indexOf(startText);
  if (start < 0) throw new Error(`Не найдено начало final-moderation региона: ${label}`);
  const end = source.indexOf(endText, start + startText.length);
  if (end < 0) throw new Error(`Не найден конец final-moderation региона: ${label}`);
  const region = source.slice(start, end);
  return `${source.slice(0, start)}${transform(region)}${source.slice(end)}`;
}

async function patchIndex() {
  let index = await read('index.html');

  index = index.replace(/<span\s+class="beta-badge"[^>]*>[\s\S]*?<\/span>/gi, '');
  index = replaceAll(index, 'закрытая бета', '');
  index = replaceAll(index, 'ЗАКРЫТАЯ БЕТА', '');
  index = replaceAll(index, 'Правила бета-тестирования', 'Работа приложения');
  index = replaceAll(index, 'Версия документа: бета 0.4', 'Редакция правил: 08.08.2026');
  index = replaceAll(index, 'Тестировщик', 'Пионер Пивника');
  index = replaceAll(index, 'Вы вошли в число первых участников закрытого бета-теста.', 'Вы вошли в число первых 30 участников «Пивника».');
  index = index.replace(/<div class="achievement-celebration-icon" id="achievementCelebrationIcon">[^<]*<\/div>/,
    '<div class="achievement-celebration-icon" id="achievementCelebrationIcon">✦</div>');
  index = replaceAll(index, 'JPG, PNG или WEBP · до 6 МБ', 'JPG, PNG или WEBP · до 3 МБ');
  index = replaceAll(
    index,
    'Крафт, лимитированные бокалы и оформление профиля — с выдачей прямо в баре.',
    'Физические товары, лимитированные бокалы и награды — с получением лично в баре.'
  );
  index = replaceAll(index, '◆ Безопасная покупка по QR', '◆ Получение по QR в баре');
  index = replaceAll(
    index,
    'Каталог разделён по категориям. Товары за бонусы выдаёт сотрудник по QR, рублёвые позиции оплачиваются в баре.',
    'Каталог физических товаров и наград. Получение происходит лично в баре по правилам программы лояльности.'
  );
  index = index.replace(
    /<div class="leaderboard-prize-note" id="leaderboardPrizeNote">[\s\S]*?<\/div>/,
    '<div class="leaderboard-prize-note" id="leaderboardPrizeNote">Лига — информационный рейтинг по подтверждённым покупкам. Призовые сезоны проводятся только при заранее опубликованных отдельных правилах.</div>'
  );

  index = index.replace(
    /(<button\b[^>]*\bid="acceptTerms"[^>]*>)[\s\S]*?(<\/button>)/,
    '$1Подтверждаю 18+ и принимаю$2'
  );

  if (!index.includes('href="/legal/terms"')) {
    const consentButton = /(<button\b[^>]*\bid="openTermsFromConsent"[^>]*>[\s\S]*?<\/button>)/;
    if (!consentButton.test(index)) throw new Error('Не найден openTermsFromConsent для юридических ссылок.');
    index = index.replace(
      consentButton,
      `$1\n      <div class="consent-legal-links" data-final-moderation="${marker}">\n        <a class="text-link" href="/legal/terms" target="_blank" rel="noopener noreferrer">Пользовательское соглашение</a>\n        <a class="text-link" href="/legal/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a>\n        <a class="text-link" href="mailto:${supportEmail}">Поддержка: ${supportEmail}</a>\n      </div>`
    );
  }

  if (!index.includes(`mailto:${supportEmail}`)) {
    const helpIntro = '<p class="help-intro">Здесь собраны правила бонусной программы, инструкция по использованию приложения и ответы на частые вопросы. Для быстрого просмотра откройте нужный пункт.</p>';
    if (!index.includes(helpIntro)) throw new Error('Не найден help-intro для контакта поддержки.');
    index = index.replace(
      helpIntro,
      `${helpIntro}\n      <div class="consent-legal-links" data-final-support="${marker}">\n        <a class="text-link" href="/legal/terms" target="_blank" rel="noopener noreferrer">Пользовательское соглашение</a>\n        <a class="text-link" href="/legal/privacy" target="_blank" rel="noopener noreferrer">Политика конфиденциальности</a>\n        <a class="text-link" href="mailto:${supportEmail}">Поддержка: ${supportEmail}</a>\n      </div>`
    );
  }

  await write('index.html', index);
}

async function patchGateway() {
  let gateway = await read('universal-server.js');
  gateway = gateway.replace(/const TERMS_VERSION = '[^']+';/, `const TERMS_VERSION = '${termsVersion}';`);
  gateway = gateway.replace(/const MAX_BODY_BYTES = [^;]+;/, 'const MAX_BODY_BYTES = 4 * 1024 * 1024;');

  if (!gateway.includes("|| pathname === '/api/me/account'")) {
    gateway = replaceRequired(
      gateway,
      "    || pathname === '/api/me/consent'",
      "    || pathname === '/api/me/consent'\n    || pathname === '/api/me/account'",
      'удаление аккаунта до принятия правил'
    );
  }

  // The platform-separation materializer rewrites this route before this pass.
  // Normalize the whole route rather than matching one historical implementation.
  gateway = replaceRegion(
    gateway,
    "    if (req.method === 'DELETE' && url.pathname === '/api/me/account') {",
    "    if (req.method === 'GET' && url.pathname === '/api/leaderboard/monthly') {",
    (region) => {
      let normalized = region.replace(
        /\n\s*if \(!user\.termsAccepted\) \{\n\s*return sendJson\(res, 428, \{ error: 'Сначала примите правила программы\.' \}\);\n\s*\}\n/,
        '\n'
      );
      if (!normalized.includes('delete-account:')) {
        normalized = normalized.replace(
          '      const user = await requireGatewayUser(req);',
          "      const user = await requireGatewayUser(req);\n      enforceRateLimit(`delete-account:${user.id}:${requestAddress(req)}`, 5, 10 * 60 * 1000);"
        );
      }
      if (normalized.includes('termsAccepted')) {
        throw new Error('Terms gate остался в маршруте удаления аккаунта.');
      }
      if (!normalized.includes('deletePlatformAccount') && !normalized.includes('deleteUnifiedAccount')) {
        throw new Error('Backend удаления аккаунта не найден после нормализации.');
      }
      return normalized;
    },
    'маршрут удаления аккаунта'
  );

  if (!gateway.includes(`// ${marker}: general API abuse protection`)) {
    const anchor = `    const url = new URL(req.url || '/', \`http://\${req.headers.host || 'localhost'}\`);\n    if (url.pathname.startsWith('/api/')) enforceMutationOrigin(req);`;
    const replacement = `${anchor}\n\n    // ${marker}: general API abuse protection. Specific sensitive endpoints keep tighter limits.\n    if (url.pathname.startsWith('/api/')) {\n      enforceRateLimit(\`api-ip:\${requestAddress(req)}\`, 300, 60 * 1000);\n      if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) {\n        const authHeader = String(req.headers.authorization || '');\n        if (authHeader.startsWith('Bearer ')) {\n          const sessionBucket = crypto.createHash('sha256').update(authHeader).digest('hex').slice(0, 24);\n          enforceRateLimit(\`api-session:\${sessionBucket}\`, 120, 60 * 1000);\n        }\n      }\n    }`;
    gateway = replaceRequired(gateway, anchor, replacement, 'общий API rate limit');
  }

  gateway = replaceAll(gateway, "title: 'Тестировщик',", "title: 'Пионер Пивника',");
  gateway = replaceAll(gateway, 'Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».', 'Легендарное достижение первых 30 участников «Пивника».');

  await write('universal-server.js', gateway);
}

async function patchServer() {
  let server = await read('server.js');
  server = server.replace(/const TERMS_VERSION = '[^']+';/, `const TERMS_VERSION = '${termsVersion}';`);
  server = server.replace("app.use(express.json({ limit: '1mb' }));", "app.use(express.json({ limit: '4mb' }));");

  server = replaceAll(server, "title: 'Тестировщик',", "title: 'Пионер Пивника',");
  server = replaceAll(server, 'Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».', 'Легендарное достижение первых 30 участников «Пивника».');
  server = replaceAll(server, 'Легендарное достижение «Тестировщик»', 'Легендарное достижение «Пионер Пивника»');
  server = replaceAll(server, 'Бета-тест — Старшина Анна Берман', 'Персональная награда — Старшина Анна Берман');
  server = replaceAll(server, 'После бета-теста: 200 бонусов после первой покупки приглашённого. Без процентов и цепочек.', 'Реферальная программа пока недоступна.');
  server = replaceAll(server, "badge: 'После беты'", "badge: 'Скоро'");
  server = replaceAll(
    server,
    "description: 'Берите две Orange Blanche — третью пинту получите в подарок. Условия и наличие уточняйте у сотрудника бара.'",
    "description: '18+. При покупке двух участвующих пинт Orange Blanche третья предоставляется в подарок. Получение только лично в баре при наличии; условия уточняйте у сотрудника до оплаты.'"
  );
  server = replaceAll(
    server,
    "description: 'Оплатите 14 литров разливного пива и получите 1 литр бесплатно.'",
    "description: '18+. После оплаты 14 литров участвующего разливного пива следующий 1 литр предоставляется в подарок. Получение только лично в баре после проверки возраста.'"
  );
  server = replaceAll(
    server,
    "prizeNote: 'После закрытия месяца участник на 1-м месте получает эпическое достижение и бесплатную пинту 0,5 л.'",
    "prizeNote: 'Лига является информационным рейтингом. Призы действуют только в сезонах с заранее опубликованными отдельными правилами.'"
  );
  server = replaceAll(
    server,
    "SELECT * FROM shop_items ORDER BY sort_order, id",
    "SELECT * FROM shop_items WHERE category <> 'profile' ORDER BY sort_order, id"
  );
  server = replaceAll(
    server,
    "note: 'Каталог разделён по категориям. Товары за бонусы выдаёт сотрудник по QR, рублёвые позиции оплачиваются в баре.'",
    "note: 'Каталог физических товаров и наград. Получение происходит лично в баре по правилам программы лояльности.'"
  );

  if (!server.includes('moderation-remove-profile-frames-from-shop')) {
    const anchor = "    await client.query('CREATE INDEX IF NOT EXISTS idx_promotions_sort ON promotions(sort_order, id)');";
    const cleanup = `    // ${marker}: moderation-remove-profile-frames-from-shop\n    await client.query(\n      \"DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond') OR category = 'profile'\"\n    );\n`;
    server = replaceRequired(server, anchor, `${cleanup}${anchor}`, 'очистка цифровых рамок магазина');
  } else {
    server = server.replace(
      "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond')",
      "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond') OR category = 'profile'"
    );
  }

  await write('server.js', server);
}

await patchIndex();
await patchGateway();
await patchServer();

console.log('VK final moderation compliance pass applied.');
