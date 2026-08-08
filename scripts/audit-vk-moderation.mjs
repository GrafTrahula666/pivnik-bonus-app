import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(name) {
  return fs.readFile(path.join(root, name), 'utf8');
}

const [index, app, vk, gateway, server, core, terms, privacy, railway, pkg] = await Promise.all([
  read('index.html'),
  read('app.js'),
  read('vk-platform.js'),
  read('universal-server.js'),
  read('server.js'),
  read('platform-core.js'),
  read('legal/terms.html'),
  read('legal/privacy.html'),
  read('railway.json'),
  read('package.json')
]);

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
const has = (text, value) => text.includes(value);
const no = (text, value) => !text.toLowerCase().includes(String(value).toLowerCase());

// 1. Public release: no beta/demo/test copy visible to normal users.
for (const phrase of [
  'закрытая бета',
  'правила бета-тестирования',
  'режиме закрытого теста',
  'версия документа: бета',
  'рабочая редакция для закрытого',
  '>тестировщик</h2>'
]) {
  check(`public-copy:${phrase}`, no(index, phrase), 'index.html');
}
check('public-copy:no-beta-badge', !/class="beta-badge"/i.test(index), 'index.html');

// 2. Explicit age gate and legal documents before use.
check('age:consent-18+', has(index, 'Подтверждаю 18+ и принимаю'));
check('age:terms-18+', has(terms, '18+'));
check('age:privacy-18+', has(privacy, '18+'));
check('legal:terms-link', has(index, 'href="/legal/terms"'));
check('legal:privacy-link', has(index, 'href="/legal/privacy"'));
check('legal:support-link', has(index, 'mailto:origtopg666@gmail.com'));
check('legal:support-sla', has(terms, 'не позднее 7 дней'));
check('legal:no-remote-alcohol-sale', has(terms, 'не осуществляет дистанционную продажу') && has(privacy, 'не осуществляет дистанционную продажу'));
check('legal:public-routes', has(gateway, "url.pathname === '/legal/privacy'") && has(gateway, "url.pathname === '/legal/terms'"));
check('legal:production-fields-required', has(gateway, 'Missing required production legal settings'));

// 3. Personal data deletion and anti-repeat tombstone.
check('deletion:route', has(gateway, "url.pathname === '/api/me/account'"));
check('deletion:consent-exempt', has(gateway, "|| pathname === '/api/me/account'"));
const deleteBlockMatch = gateway.match(/if \(req\.method === 'DELETE' && url\.pathname === '\/api\/me\/account'\) \{([\s\S]*?)\n    \}/);
check('deletion:no-terms-gate', Boolean(deleteBlockMatch) && !deleteBlockMatch[1].includes('termsAccepted'));
check('deletion:confirmation', has(gateway, 'Введите слово «УДАЛИТЬ»'));
check('deletion:identity-cleanup', has(gateway, 'DELETE FROM user_identities') && has(gateway, 'deleted_at = NOW()'));
check('deletion:tombstone-secret', has(gateway, 'identityTombstoneSecret') && has(gateway, 'deletedIdentityHash'));
check('deletion:session-revocation', has(gateway, 'session_version = session_version + 1'));

// 4. Abuse/load protection.
check('load:global-ip-rate-limit', has(gateway, 'api-ip:${requestAddress(req)}'));
check('load:session-rate-limit', has(gateway, 'api-session:${sessionBucket}'));
check('load:invalid-auth-rate-limit', has(gateway, 'auth-invalid:'));
check('load:qr-rate-limit', has(gateway, 'enforceRateLimit(`qr:'));
check('load:pin-rate-limit', has(gateway, 'enforceRateLimit(`pin:'));
check('load:delete-rate-limit', has(gateway, 'delete-account:'));
check('load:gateway-payload-4mb', has(gateway, 'const MAX_BODY_BYTES = 4 * 1024 * 1024;'));
check('load:server-payload-4mb', has(server, "express.json({ limit: '4mb' })"));
check('load:image-limit-ui', has(index, 'до 3 МБ'));
check('load:image-limit-server', has(server, 'MAX_CONTENT_IMAGE_BYTES = 3_200_000'));

// 5. Idempotency / financial safety.
check('idempotency:request-key-unique', has(server, 'request_key TEXT UNIQUE'));
check('idempotency:request-lock', has(server, 'lockRequestKey'));
check('idempotency:cancel-key', has(server, 'cancel_request_key'));

// 6. VK Bridge and signed authentication.
check('vk:init', has(vk, "bridge.send('VKWebAppInit')"));
check('vk:user-info', has(vk, "bridge.send('VKWebAppGetUserInfo')"));
check('vk:lifecycle-subscribe', has(vk, 'bridge.subscribe'));
check('vk:view-restore', has(vk, 'VKWebAppViewRestore'));
check('vk:launch-signature-server', has(core, 'validateVkLaunchParams') && has(core, "createHmac('sha256', appSecret)"));
check('vk:auth-age-limit', has(core, 'DEFAULT_AUTH_MAX_AGE_SECONDS'));
check('vk:minimal-bridge-usage', !has(vk, 'VKWebAppGetPhoneNumber') && !has(vk, 'VKWebAppGetEmail') && !has(vk, 'VKWebAppGetGeodata'));

// 7. Monetization and contests.
check('shop:no-profile-category-public', has(server, "SELECT * FROM shop_items WHERE category <> 'profile'"));
check('shop:frame-cleanup', has(server, "frame-money-owner") && has(server, "OR category = 'profile'"));
check('shop:physical-copy', has(index, 'Физические товары, лимитированные бокалы и награды'));
check('bonuses:not-sold', has(terms, 'не продаются пользователю за денежные средства'));
check('league:informational', has(index, 'Лига — информационный рейтинг') && has(terms, 'Лига Пивника сама по себе является информационным рейтингом'));
check('league:no-unruled-pint-prize', no(server, 'участник на 1-м месте получает эпическое достижение и бесплатную пинту'));
check('promotions:alcohol-18+', has(server, 'Orange Blanche') && has(server, "description: '18+.") && has(server, 'Получение только лично в баре'));

// 8. Production hardening / release behavior.
check('production:no-demo', has(gateway, 'ALLOW_DEMO cannot be enabled in production'));
check('production:release-readiness', has(gateway, '/api/release-readiness'));
check('production:railway-npm-start', has(railway, 'PIVNIK_DOCUMENT_PLATFORM=vk npm start'));
check('production:railway-readiness-healthcheck', has(railway, '"healthcheckPath": "/api/release-readiness"'));
check('production:auto-refresh-build', has(app, '__pivnik_build_check') && has(app, 'dataset.hardRefreshInstalled'));
check('production:final-pass-wired', has(pkg, 'apply-vk-moderation-final-pass.mjs'));
check('production:audit-wired', has(pkg, 'audit-vk-moderation.mjs'));
check('terms:current-version-gateway', has(gateway, "const TERMS_VERSION = '2026-08-08';"));
check('terms:current-version-server', has(server, "const TERMS_VERSION = '2026-08-08';"));

const failed = checks.filter((item) => !item.ok);
const passed = checks.length - failed.length;
console.log(`VK moderation audit: ${passed}/${checks.length} checks passed.`);
if (failed.length) {
  for (const item of failed) console.error(`FAIL ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  process.exitCode = 1;
  throw new Error(`VK moderation audit failed: ${failed.length} check(s).`);
}
console.log('VK moderation audit passed. Manual VK cabinet/device checks remain outside repository scope.');
