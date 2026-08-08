import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFile(path.join(root, name), 'utf8');
const write = (name, value) => fs.writeFile(path.join(root, name), value, 'utf8');

const files = Object.fromEntries(await Promise.all([
  'index.html', 'app.js', 'vk-platform.js', 'universal-server.js', 'server.js',
  'legal/terms.html', 'legal/privacy.html', 'railway.json', 'package.json'
].map(async (name) => [name, await read(name)])));

files['index.html'] = files['index.html']
  .replace(/<span\s+class="beta-badge"[^>]*>[\s\S]*?<\/span>/gi, '')
  .replaceAll('Private stock', 'Особая коллекция')
  .replaceAll('Telegram Mini App', 'Приложение')
  .replaceAll('Награды за 1–3 место появятся после бета-теста.', 'Лига — информационный рейтинг по подтверждённым покупкам.')
  .replaceAll('Правила бета-тестирования', 'Работа приложения')
  .replaceAll('Приложение находится в режиме закрытого теста. Интерфейс, расчёты и отдельные функции могут изменяться.', 'Приложение работает как программа лояльности бара «ПИВНИК». Актуальные условия опубликованы в правилах.')
  .replaceAll('Версия документа: бета 0.4', 'Редакция правил: 08.08.2026')
  .replaceAll('Рабочая редакция для закрытого бета-теста, версия 0.4.', 'Действующая редакция правил программы лояльности от 08.08.2026.');

files['vk-platform.js'] = files['vk-platform.js']
  .replaceAll("eyebrow.textContent = 'VK Mini App';", "eyebrow.textContent = 'Приложение VK';");

files['universal-server.js'] = files['universal-server.js'].replaceAll(
  "prizeNote: 'После закрытия месяца участник на 1-м месте получает эпическое достижение и бесплатную пинту 0,5 л.',",
  "prizeNote: 'Лига — информационный рейтинг по подтверждённой сумме покупок за текущий месяц.',"
);

await write('index.html', files['index.html']);
await write('vk-platform.js', files['vk-platform.js']);
await write('universal-server.js', files['universal-server.js']);

const failures = [];
const ok = (condition, label) => { if (!condition) failures.push(label); };
const has = (name, text) => files[name].includes(text);
const hasAny = (name, values) => values.some((value) => files[name].includes(value));

const visibleForbidden = [
  'закрытая бета', 'ЗАКРЫТАЯ БЕТА', 'Правила бета-тестирования',
  'режиме закрытого теста', 'Версия документа: бета',
  'Рабочая редакция для закрытого бета-теста', 'после бета-теста',
  'Private stock'
];
for (const phrase of visibleForbidden) {
  ok(!files['index.html'].toLowerCase().includes(phrase.toLowerCase()), `PUBLIC_UI:${phrase}`);
}
ok(!files['index.html'].includes('class="beta-badge"'), 'PUBLIC_UI:beta-badge');

ok(has('index.html', '/legal/terms'), 'LEGAL:terms-link');
ok(has('index.html', '/legal/privacy'), 'LEGAL:privacy-link');
ok(has('index.html', 'mailto:'), 'LEGAL:support-link');
ok(has('index.html', '18+'), 'LEGAL:18+-consent');
ok(has('index.html', 'acceptTerms'), 'LEGAL:explicit-consent-button');
ok(has('vk-platform.js', 'consentExplicit'), 'LEGAL:explicit-consent-state');
ok(has('vk-platform.js', "pathname === '/api/me/consent' && !consentExplicit"), 'LEGAL:no-automatic-consent');

ok(has('index.html', 'Удалить аккаунт'), 'DELETE:UI-entry');
ok(has('app.js', "method: 'DELETE'"), 'DELETE:client-method');
ok(has('app.js', "'/api/me/account'"), 'DELETE:client-route');
ok(has('app.js', 'УДАЛИТЬ'), 'DELETE:explicit-confirmation');
ok(hasAny('universal-server.js', ['deleteUnifiedAccount', 'deleteAccountData']), 'DELETE:backend-service');
ok(has('universal-server.js', "DELETE"), 'DELETE:backend-method');

ok(has('universal-server.js', 'enforceRateLimit'), 'SECURITY:rate-limit');
ok(has('universal-server.js', 'MAX_BODY_BYTES = 4 * 1024 * 1024'), 'SECURITY:gateway-payload-limit');
ok(has('server.js', "express.json({ limit: '4mb' })"), 'SECURITY:express-payload-limit');
ok(hasAny('server.js', ['lockRequestKey', 'request_key']), 'SECURITY:idempotency');
ok(has('server.js', 'MAX_CONTENT_IMAGE_BYTES'), 'SECURITY:content-image-limit');

ok(has('vk-platform.js', "bridge.send('VKWebAppInit')"), 'VK_BRIDGE:init');
ok(has('vk-platform.js', "bridge.send('VKWebAppGetUserInfo')"), 'VK_BRIDGE:user-info');
ok(has('vk-platform.js', 'bridge.subscribe'), 'VK_BRIDGE:subscribe');
ok(has('vk-platform.js', 'VKWebAppViewHide'), 'VK_BRIDGE:view-hide');
ok(has('vk-platform.js', 'VKWebAppViewRestore'), 'VK_BRIDGE:view-restore');
ok(has('vk-platform.js', 'VKWebAppUpdateConfig'), 'VK_BRIDGE:update-config');
ok(has('universal-server.js', 'validateVkLaunchParams'), 'VK_AUTH:signed-launch-validation');
ok(has('universal-server.js', "EXPECTED_VK_APP_ID = '54694987'"), 'VK_AUTH:app-id');

ok(has('universal-server.js', "process.env.NODE_ENV === 'production' && allowDemo"), 'PRODUCTION:demo-disabled');
ok(!files['index.html'].includes('?demo=1'), 'PRODUCTION:no-demo-link');
ok(has('railway.json', 'PIVNIK_DOCUMENT_PLATFORM=vk npm start'), 'PRODUCTION:vk-start-command');
ok(has('railway.json', '/api/release-readiness'), 'PRODUCTION:release-readiness-healthcheck');

ok(has('vk-platform.js', "eyebrow.textContent = 'Приложение VK'"), 'LOCALE:vk-label-russian');
ok(!files['index.html'].includes('Private stock'), 'LOCALE:shop-kicker-russian');
ok(!/\b(debug|development mode|test mode)\b/i.test(files['index.html']), 'LOCALE:no-dev-copy');

ok(has('index.html', 'Лига — информационный рейтинг'), 'PROMO:league-informational');
ok(!/1[–-]3 место.*(приз|наград)/i.test(files['index.html']), 'PROMO:no-unruled-league-prize-ui');
ok(!files['universal-server.js'].includes('получает эпическое достижение и бесплатную пинту'), 'PROMO:no-unruled-league-prize-api');
ok(has('universal-server.js', "prizeNote: 'Лига — информационный рейтинг"), 'PROMO:league-api-informational');
ok(has('legal/terms.html', 'совершеннолет'), 'PROMO:adult-terms');
ok(has('legal/terms.html', 'Приложение не используется для дистанционной продажи алкоголя'), 'PROMO:no-remote-alcohol-sale');
ok(has('legal/privacy.html', 'Возрастное ограничение'), 'PROMO:adult-privacy');

ok(has('server.js', 'moderation-remove-profile-frames-from-shop'), 'MONETIZATION:frame-cleanup-migration');
ok(has('server.js', "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond')"), 'MONETIZATION:frame-db-delete');
ok(has('server.js', 'DEFAULT_SHOP_ITEMS.filter'), 'MONETIZATION:frame-default-filter');

ok(has('legal/terms.html', '{{LEGAL_CONTACT_EMAIL}}'), 'SUPPORT:terms-contact');
ok(has('legal/privacy.html', '{{LEGAL_CONTACT_EMAIL}}'), 'SUPPORT:privacy-contact');
ok(has('universal-server.js', 'Индивидуальный предприниматель Иживильгин Виталий Викторович'), 'LEGAL:operator-name');
ok(has('universal-server.js', 'ИНН 380415014659'), 'LEGAL:operator-id');
ok(has('universal-server.js', 'origtopg666@gmail.com'), 'LEGAL:operator-email');
ok(has('universal-server.js', 'г. Санкт-Петербург, проспект Энгельса, д. 55'), 'LEGAL:operator-address');

ok(has('legal/privacy.html', 'Какие данные обрабатываются'), 'PRIVACY:data-list');
ok(has('legal/privacy.html', 'Цели обработки'), 'PRIVACY:purposes');
ok(has('legal/privacy.html', 'Исправление и удаление'), 'PRIVACY:deletion');
ok(has('legal/privacy.html', 'непосредственно в приложении'), 'PRIVACY:in-app-delete');
ok(has('legal/privacy.html', 'не продаются рекламодателям'), 'PRIVACY:no-data-sale');

ok(has('package.json', 'apply-public-release-copy.mjs'), 'CHAIN:public-release-copy');
ok(has('package.json', 'apply-vk-moderation-hardening.mjs'), 'CHAIN:moderation-hardening');
ok(has('package.json', 'apply-no-beta-public-guard.mjs'), 'CHAIN:no-beta-guard');
ok(has('package.json', 'vk-moderation-gate.mjs'), 'CHAIN:moderation-gate');

if (failures.length) {
  console.error('VK MODERATION GATE: FAIL');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log('VK MODERATION GATE: PASS');
console.log('Verified: public copy, consent/legal, deletion, security, VK Bridge, production safety, localization, promotions, monetization, support and privacy.');
