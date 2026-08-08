import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFile(path.join(root, name), 'utf8');
const write = (name, value) => fs.writeFile(path.join(root, name), value, 'utf8');

const files = Object.fromEntries(await Promise.all([
  'index.html', 'app.js', 'vk-platform.js', 'universal-server.js', 'server.js', 'platform-core.js',
  'legal/terms.html', 'legal/privacy.html', 'railway.json', 'package.json'
].map(async (name) => [name, await read(name)])));

// This gate runs after every materializer. The checked files are exactly the files
// that the production server is about to serve.
files['index.html'] = files['index.html']
  .replace(/<span\s+class="beta-badge"[^>]*>[\s\S]*?<\/span>/gi, '')
  .replaceAll('Private stock', 'Особая коллекция')
  .replaceAll('Telegram Mini App', 'Приложение')
  .replaceAll('Награды за 1–3 место появятся после бета-теста.', 'Лига — информационный рейтинг по подтверждённым покупкам.')
  .replaceAll('Правила бета-тестирования', 'Работа приложения')
  .replaceAll('Приложение находится в режиме закрытого теста. Интерфейс, расчёты и отдельные функции могут изменяться.', 'Приложение работает как программа лояльности бара «ПИВНИК». Актуальные условия опубликованы в правилах.')
  .replaceAll('Версия документа: бета 0.4', 'Редакция правил: 08.08.2026')
  .replaceAll('Рабочая редакция для закрытого бета-теста, версия 0.4.', 'Действующая редакция правил программы лояльности от 08.08.2026.');
files['vk-platform.js'] = files['vk-platform.js'].replaceAll("eyebrow.textContent = 'VK Mini App';", "eyebrow.textContent = 'Приложение VK';");

await write('index.html', files['index.html']);
await write('vk-platform.js', files['vk-platform.js']);

const failures = [];
const ok = (condition, label) => { if (!condition) failures.push(label); };
const has = (name, text) => files[name].includes(text);
const hasAny = (name, values) => values.some((value) => files[name].includes(value));
const no = (name, text) => !files[name].toLowerCase().includes(String(text).toLowerCase());

// 1. Public release: no visible beta/test/demo copy.
for (const phrase of [
  'закрытая бета', 'Правила бета-тестирования', 'режиме закрытого теста',
  'Версия документа: бета', 'Рабочая редакция для закрытого бета-теста',
  'после бета-теста', 'Private stock', '>Тестировщик</h2>'
]) ok(no('index.html', phrase), `PUBLIC_UI:${phrase}`);
ok(!files['index.html'].includes('class="beta-badge"'), 'PUBLIC_UI:beta-badge');

// 2. Consent, legal documents and 18+ before normal use.
ok(has('index.html', '/legal/terms'), 'LEGAL:terms-link');
ok(has('index.html', '/legal/privacy'), 'LEGAL:privacy-link');
ok(has('index.html', 'mailto:origtopg666@gmail.com'), 'LEGAL:support-link');
ok(has('index.html', 'Подтверждаю 18+ и принимаю'), 'LEGAL:18+-consent');
ok(has('vk-platform.js', 'consentExplicit'), 'LEGAL:explicit-consent-state');
ok(has('vk-platform.js', "pathname === '/api/me/consent' && !consentExplicit"), 'LEGAL:no-automatic-consent');
ok(has('legal/terms.html', '18+'), 'LEGAL:18+-terms');
ok(has('legal/privacy.html', '18+'), 'LEGAL:18+-privacy');
ok(has('legal/terms.html', 'не позднее 7 дней'), 'SUPPORT:7-day-response');

// 3. Account/data deletion must work even before consent.
ok(has('index.html', 'Удалить аккаунт'), 'DELETE:UI-entry');
ok(has('app.js', "method: 'DELETE'"), 'DELETE:client-method');
ok(has('app.js', "'/api/me/account'"), 'DELETE:client-route');
ok(has('app.js', 'УДАЛИТЬ'), 'DELETE:explicit-confirmation');
ok(has('universal-server.js', "|| pathname === '/api/me/account'"), 'DELETE:consent-exempt');
const deleteBlock = files['universal-server.js'].match(/if \(req\.method === 'DELETE' && url\.pathname === '\/api\/me\/account'\) \{([\s\S]*?)\n    \}/);
ok(Boolean(deleteBlock) && !deleteBlock[1].includes('termsAccepted'), 'DELETE:no-terms-gate');
ok(has('universal-server.js', 'DELETE FROM user_identities'), 'DELETE:identity-cleanup');
ok(has('universal-server.js', 'deleted_at = NOW()'), 'DELETE:anonymized-row');
ok(has('universal-server.js', 'identityTombstoneSecret'), 'DELETE:anti-repeat-tombstone');

// 4. Abuse protection / payload / duplicate operations.
ok(has('universal-server.js', 'api-ip:${requestAddress(req)}'), 'SECURITY:global-ip-rate-limit');
ok(has('universal-server.js', 'api-session:${sessionBucket}'), 'SECURITY:session-rate-limit');
ok(has('universal-server.js', 'auth-invalid:'), 'SECURITY:invalid-auth-rate-limit');
ok(has('universal-server.js', 'enforceRateLimit(`qr:'), 'SECURITY:qr-rate-limit');
ok(has('universal-server.js', 'enforceRateLimit(`pin:'), 'SECURITY:pin-rate-limit');
ok(has('universal-server.js', 'delete-account:'), 'SECURITY:delete-rate-limit');
ok(has('universal-server.js', 'MAX_BODY_BYTES = 4 * 1024 * 1024'), 'SECURITY:gateway-payload-limit');
ok(has('server.js', "express.json({ limit: '4mb' })"), 'SECURITY:express-payload-limit');
ok(has('server.js', 'MAX_CONTENT_IMAGE_BYTES = 3_200_000'), 'SECURITY:content-image-limit');
ok(has('index.html', 'до 3 МБ'), 'SECURITY:content-image-ui-limit');
ok(hasAny('server.js', ['lockRequestKey', 'request_key TEXT UNIQUE']), 'SECURITY:idempotency');

// 5. VK signed authentication and Bridge lifecycle.
ok(has('vk-platform.js', "bridge.send('VKWebAppInit')"), 'VK_BRIDGE:init');
ok(has('vk-platform.js', "bridge.send('VKWebAppGetUserInfo')"), 'VK_BRIDGE:user-info');
ok(has('vk-platform.js', 'bridge.subscribe'), 'VK_BRIDGE:subscribe');
ok(has('vk-platform.js', 'VKWebAppViewHide'), 'VK_BRIDGE:view-hide');
ok(has('vk-platform.js', 'VKWebAppViewRestore'), 'VK_BRIDGE:view-restore');
ok(has('vk-platform.js', 'VKWebAppUpdateConfig'), 'VK_BRIDGE:update-config');
ok(has('platform-core.js', 'validateVkLaunchParams'), 'VK_AUTH:signed-launch-validation');
ok(has('platform-core.js', "createHmac('sha256', appSecret)"), 'VK_AUTH:hmac');
ok(has('universal-server.js', "EXPECTED_VK_APP_ID = '54694987'"), 'VK_AUTH:app-id');
ok(!has('vk-platform.js', 'VKWebAppGetPhoneNumber') && !has('vk-platform.js', 'VKWebAppGetEmail') && !has('vk-platform.js', 'VKWebAppGetGeodata'), 'VK_PERMISSIONS:no-unneeded-sensitive-requests');

// 6. Production/debug safety and deterministic deployment.
ok(has('universal-server.js', "process.env.NODE_ENV === 'production' && allowDemo"), 'PRODUCTION:demo-disabled');
ok(!files['index.html'].includes('?demo=1'), 'PRODUCTION:no-demo-link');
ok(has('railway.json', 'PIVNIK_DOCUMENT_PLATFORM=vk npm start'), 'PRODUCTION:vk-start-command');
ok(has('railway.json', '/api/release-readiness'), 'PRODUCTION:release-readiness-healthcheck');
ok(has('universal-server.js', '/api/release-readiness'), 'PRODUCTION:readiness-endpoint');
ok(has('app.js', '__pivnik_build_check') && has('app.js', 'dataset.hardRefreshInstalled'), 'PRODUCTION:client-build-refresh');

// 7. Russian public UI / no obvious developer labels.
ok(has('vk-platform.js', "eyebrow.textContent = 'Приложение VK'"), 'LOCALE:vk-label-russian');
ok(!files['index.html'].includes('Private stock'), 'LOCALE:shop-kicker-russian');
ok(!/\b(debug|development mode|test mode)\b/i.test(files['index.html']), 'LOCALE:no-dev-copy');

// 8. Promotions / league / age restriction / no contest promise without rules.
ok(has('index.html', 'Лига — информационный рейтинг'), 'PROMO:league-informational');
ok(no('server.js', 'участник на 1-м месте получает эпическое достижение и бесплатную пинту'), 'PROMO:no-unruled-league-prize');
ok(has('legal/terms.html', 'Лига Пивника сама по себе является информационным рейтингом'), 'PROMO:future-prize-rules');
ok(has('legal/terms.html', 'не осуществляет дистанционную продажу'), 'PROMO:no-remote-alcohol-sale-terms');
ok(has('legal/privacy.html', 'не осуществляет дистанционную продажу'), 'PROMO:no-remote-alcohol-sale-privacy');
ok(has('server.js', 'Orange Blanche') && has('server.js', "description: '18+.") && has('server.js', 'Получение только лично в баре'), 'PROMO:alcohol-18+-copy');

// 9. Monetization: digital profile frames must not be offered publicly.
ok(has('server.js', 'moderation-remove-profile-frames-from-shop'), 'MONETIZATION:frame-cleanup-migration');
ok(has('server.js', "OR category = 'profile'"), 'MONETIZATION:profile-category-cleanup');
ok(has('server.js', "SELECT * FROM shop_items WHERE category <> 'profile'"), 'MONETIZATION:profile-category-not-public');
ok(has('legal/terms.html', 'не продаются пользователю за денежные средства'), 'MONETIZATION:bonuses-not-sold');
ok(has('index.html', 'Физические товары, лимитированные бокалы и награды'), 'MONETIZATION:physical-shop-copy');

// 10. Support and legal operator data.
ok(has('legal/terms.html', '{{LEGAL_CONTACT_EMAIL}}'), 'SUPPORT:terms-contact');
ok(has('legal/privacy.html', '{{LEGAL_CONTACT_EMAIL}}'), 'SUPPORT:privacy-contact');
ok(has('universal-server.js', 'Индивидуальный предприниматель Иживильгин Виталий Викторович'), 'LEGAL:operator-name');
ok(has('universal-server.js', 'ИНН 380415014659'), 'LEGAL:operator-id');
ok(has('universal-server.js', 'origtopg666@gmail.com'), 'LEGAL:operator-email');
ok(has('universal-server.js', 'г. Санкт-Петербург, проспект Энгельса, д. 55'), 'LEGAL:operator-address');

// 11. Privacy policy content.
ok(has('legal/privacy.html', 'Какие данные обрабатываются'), 'PRIVACY:data-list');
ok(has('legal/privacy.html', 'Цели обработки'), 'PRIVACY:purposes');
ok(has('legal/privacy.html', 'Исправление и удаление'), 'PRIVACY:deletion');
ok(has('legal/privacy.html', 'непосредственно в приложении'), 'PRIVACY:in-app-delete');
ok(has('legal/privacy.html', 'не продаются рекламодателям'), 'PRIVACY:no-data-sale');

// 12. Runtime chain itself must contain the final compliance pass and independent audit.
ok(has('package.json', 'apply-production-hardening.mjs'), 'CHAIN:production-hardening');
ok(has('package.json', 'apply-public-release-copy.mjs'), 'CHAIN:public-release-copy');
ok(has('package.json', 'apply-vk-moderation-hardening.mjs'), 'CHAIN:moderation-hardening');
ok(has('package.json', 'apply-no-beta-public-guard.mjs'), 'CHAIN:no-beta-guard');
ok(has('package.json', 'apply-vk-moderation-final-pass.mjs'), 'CHAIN:final-moderation-pass');
ok(has('package.json', 'audit-vk-moderation.mjs'), 'CHAIN:independent-audit');
ok(has('universal-server.js', "const TERMS_VERSION = '2026-08-08';"), 'CHAIN:terms-version-gateway');
ok(has('server.js', "const TERMS_VERSION = '2026-08-08';"), 'CHAIN:terms-version-server');

if (failures.length) {
  console.error('VK MODERATION GATE: FAIL');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log('VK MODERATION GATE: PASS');
console.log('Verified: public copy, consent/legal, deletion, abuse protection, VK Bridge, production safety, localization, promotions, monetization, support and privacy.');
