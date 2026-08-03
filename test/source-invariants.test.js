import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'css-tree';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Запуск использует единый gateway и локальный VK Bridge', async () => {
  const [packageJson, gateway] = await Promise.all([
    source('package.json'),
    source('universal-server.js')
  ]);
  const pkg = JSON.parse(packageJson);
  assert.equal(pkg.scripts.start, 'node universal-server.js');
  assert.equal(pkg.dependencies['@vkontakte/vk-bridge'], '2.15.11');
  assert.match(gateway, /\/vendor\/vk-bridge\.js/);
  assert.match(gateway, /@vkontakte', 'vk-bridge', 'dist', 'browser\.min\.js/);
  assert.match(gateway, /__PIVNIK_EARLY_VK_INIT_PROMISE__/);
  assert.match(gateway, /scriptNonce/);
  assert.doesNotMatch(gateway, /unpkg|cdn\.jsdelivr/i);
});

test('VK запускается через подписанный ID и сохраняет изолированную сессию аккаунта', async () => {
  const vk = await source('vk-platform.js');
  const initPosition = vk.indexOf("VKWebAppInit");
  const userPosition = vk.indexOf("VKWebAppGetUserInfo");
  assert.ok(initPosition >= 0 && userPosition > initPosition);
  assert.match(vk, /BRIDGE_INIT_TIMEOUT_MS/);
  assert.match(vk, /BRIDGE_PROFILE_TIMEOUT_MS/);
  assert.match(vk, /earlyBridgeInitPromise \|\| bridge\.send\('VKWebAppInit'\)/);
  assert.match(vk, /VKWebAppGetLaunchParams/);
  assert.match(vk, /window\.location\.hash/);
  assert.match(vk, /response\.status === 401/);
  assert.doesNotMatch(vk, /waitForBridge/);
  assert.match(vk, /launchVkUserId/);
  assert.match(vk, /String\(vkUser\.id\) !== launchVkUserId/);
  assert.match(vk, /pivnik_vk_\$\{launchVkUserId \|\| 'unknown'\}_/);
  assert.match(vk, /if \(!launchVkUserId\)[\s\S]*?staff_session/);
  assert.doesNotMatch(vk, /removeItem\(`\$\{storagePrefix\}(?:session|staff_session)`\)/);
  assert.match(vk, /code_data \|\| data\?\.code/);
  assert.match(vk, /VKWebAppViewHide/);
  assert.match(vk, /VKWebAppViewRestore/);
  assert.match(vk, /bridge\?\.subscribe\?\.\(handleBridgeEvent\)/);
  assert.match(vk, /pivnik:platform-restored/);
  assert.doesNotMatch(vk, /Storage\.prototype/);
});

test('Telegram и VK используют разные ключи localStorage', async () => {
  const [app, accountLink] = await Promise.all([
    source('app.js'),
    source('account-link.js')
  ]);
  assert.match(app, /__PIVNIK_STORAGE_PREFIX__/);
  assert.match(app, /pivnik_tg_/);
  assert.match(accountLink, /__PIVNIK_STORAGE_PREFIX__/);
  assert.doesNotMatch(app, /localStorage\.getItem\(['"]pivnik_session['"]\)/);
});

test('Согласие отправляется только обработчиком явной кнопки', async () => {
  const [app, accountLink, server, gateway] = await Promise.all([
    source('app.js'),
    source('account-link.js'),
    source('server.js'),
    source('universal-server.js')
  ]);
  assert.doesNotMatch(app, /syncFirstRunState/);
  assert.match(app, /#acceptTerms.*addEventListener\('click'/s);
  assert.match(app, /x-pivnik-explicit-consent/);
  assert.match(accountLink, /explicitConsent = true/);
  assert.doesNotMatch(accountLink, /MutationObserver/);
  assert.doesNotMatch(accountLink, /scheduleConsentGate|openConsentGate/);
  assert.match(server, /x-pivnik-explicit-consent/);
  assert.match(gateway, /x-pivnik-explicit-consent/);
  assert.match(gateway, /grantReward\([\s\S]*?'welcome-100'/);
  assert.match(server, /onboarding_completed_at, is_creator/);
  assert.match(server, /role === 'admin'/);
  assert.doesNotMatch(server, /ensureUserSetupDefaults/);
});

test('Миграции создают идентичности, награды, aliases, аудит и единственного создателя', async () => {
  const [migration, creatorMigration] = await Promise.all([
    source('migrations/001_add_platform_identities.sql'),
    source('migrations/004_creator_identity.sql')
  ]);
  assert.match(migration, /UNIQUE \(provider, provider_user_id\)/);
  assert.match(migration, /UNIQUE \(user_id, provider\)/);
  assert.match(migration, /PRIMARY KEY \(code, user_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS qr_aliases/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS account_merge_audit/);
  assert.match(migration, /session_version BIGINT NOT NULL DEFAULT 1/);
  assert.match(migration, /idx_transactions_leaderboard/);
  assert.match(migration, /idx_transactions_cancel_request_key/);
  assert.match(creatorMigration, /is_creator BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(creatorMigration, /idx_users_single_creator/);
});

test('Публичный запуск требует 18+, даёт документы и безвозвратное удаление', async () => {
  const [migration, gateway, server, app, index, privacy, terms] = await Promise.all([
    source('migrations/003_public_launch_requirements.sql'),
    source('universal-server.js'),
    source('server.js'),
    source('app.js'),
    source('index.html'),
    source('legal/privacy.html'),
    source('legal/terms.html')
  ]);
  assert.match(migration, /adult_confirmed_at/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS account_deletion_audit/);
  assert.doesNotMatch(migration, /account_deletion_audit[\s\S]*?user_id/);
  assert.match(gateway, /TERMS_VERSION = 'public-1\.0'/);
  assert.match(server, /TERMS_VERSION = 'public-1\.0'/);
  assert.match(gateway, /adult_confirmed_at/);
  assert.match(app, /adultConfirmed: true/);
  assert.match(index, /id="adultConfirmed"/);
  assert.match(index, /href="\/legal\/terms"/);
  assert.match(index, /href="\/legal\/privacy"/);
  assert.match(index, /id="openDeleteAccountButton"/);
  assert.match(index, /id="deleteAccountFromConsent"/);
  assert.match(app, /confirmation: 'УДАЛИТЬ'/);
  assert.match(gateway, /req\.method === 'DELETE'.*?\/api\/me\/account/s);
  assert.match(gateway, /export async function deleteUnifiedAccount/);
  assert.match(gateway, /DELETE FROM transactions WHERE client_id/);
  assert.match(gateway, /UPDATE transactions SET staff_id = NULL/);
  assert.match(gateway, /DELETE FROM users WHERE id = ANY/);
  assert.match(privacy, /безвозвратно удалить единый аккаунт/i);
  assert.match(terms, /Удаление аккаунта/);
});

test('Лимиты запросов переживают перезапуск, а загрузка укладывается в единый предел', async () => {
  const [migration, gateway, server, app, index] = await Promise.all([
    source('migrations/003_public_launch_requirements.sql'),
    source('universal-server.js'),
    source('server.js'),
    source('app.js'),
    source('index.html')
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS api_rate_limits/);
  assert.match(gateway, /INSERT INTO api_rate_limits/);
  assert.match(gateway, /ON CONFLICT \(subject_hash, route_group\) DO UPDATE/);
  assert.match(gateway, /rateLimitSubjectHash\('ip'/);
  assert.match(gateway, /rateLimitSubjectHash\('user'/);
  assert.match(gateway, /rateLimitSubjectHash\('auth-identity'/);
  assert.match(gateway, /globalApiRateLimitSubject/);
  assert.match(gateway, /'\/api\/auth'\]\.includes/);
  assert.match(gateway, /MAX_BODY_BYTES = 4 \* 1024 \* 1024/);
  assert.match(server, /express\.json\(\{ limit: '4mb' \}\)/);
  assert.match(app, /output\.length < 2_700_000/);
  assert.match(index, /исходник до 6 МБ/);
});

test('Поддержка доступна в приложении и ограничена по частоте', async () => {
  const [gateway, server, app, index] = await Promise.all([
    source('universal-server.js'),
    source('server.js'),
    source('app.js'),
    source('index.html')
  ]);
  assert.match(index, /id="supportModal"/);
  assert.match(index, /не позднее 7 календарных дней/);
  assert.match(app, /api\('\/api\/support'/);
  assert.match(server, /app\.post\('\/api\/support'/);
  assert.match(gateway, /'support-request',[\s\S]*?5,[\s\S]*?24 \* 60 \* 60 \* 1000/);
});

test('В публичной разметке нет признаков незавершённой бета-версии', async () => {
  const index = await source('index.html');
  assert.doesNotMatch(index, /закрытая бета|бета-тест|рабочая редакция|будет дополнено|после бета/i);
  assert.match(index, /Редакция правил: 1\.0/);
});

test('Публичные акции и магазин скрывают незавершённые и цифровые рублёвые позиции', async () => {
  const server = await source('server.js');
  assert.match(server, /FROM promotions WHERE active = TRUE/);
  assert.match(server, /FROM shop_items[\s\S]*?WHERE active = TRUE[\s\S]*?category = 'profile'[\s\S]*?price_type = 'rub'/);
  assert.match(server, /frame-money-owner[\s\S]*?active: false/);
  assert.match(server, /frame-fire-partner[\s\S]*?active: false/);
});

test('Объединение блокирует строки, переносит связи, архивирует дубль и сверяет журнал', async () => {
  const [gateway, server] = await Promise.all([
    source('universal-server.js'),
    source('server.js')
  ]);
  assert.match(gateway, /ORDER BY id FOR UPDATE/);
  assert.match(gateway, /SET LOCAL lock_timeout = '2500ms'/);
  assert.match(gateway, /SET LOCAL statement_timeout = '6000ms'/);
  assert.match(gateway, /UPDATE user_identities[\s\S]*SET user_id/);
  assert.match(gateway, /INSERT INTO qr_aliases/);
  assert.match(gateway, /UPDATE transactions SET client_id/);
  assert.match(gateway, /UPDATE shift_members|INSERT INTO shift_members/);
  assert.match(gateway, /UPDATE shop_inquiries SET user_id/);
  assert.match(gateway, /merged_into_user_id = \$1::bigint/);
  assert.match(gateway, /verifiedLedgerBalance !== finalBalance/);
  assert.match(gateway, /account_merge_audit/);
  assert.doesNotMatch(gateway, /анна берман|аня берман|берман анна/i);
  assert.match(gateway, /if \(storedFrame === 'anna'\) return 'none'/);
  assert.match(server, /if \(storedFrame === 'anna'\) return 'none'/);
});

test('Все изменяющие бонусы маршруты используют requestKey и advisory lock', async () => {
  const [server, app] = await Promise.all([source('server.js'), source('app.js')]);
  assert.match(server, /financial-request:\$\{requestKey\}/);
  assert.match(server, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(server, /cancel_request_key = \$3/);
  assert.match(server, /request_key, client_id, staff_id, mode/);
  assert.match(app, /data-staff-cancel[\s\S]*?requestKey: requestId\(\)/);
  assert.match(app, /data-admin-cancel[\s\S]*?requestKey: requestId\(\)/);
  assert.match(app, /data-adjust-user[\s\S]*?requestKey: requestId\(\)/);
  assert.match(app, /carriesRequestKey[\s\S]*?attempts/);
});

test('Смена роли и PIN инвалидирует старые сессии', async () => {
  const [server, gateway] = await Promise.all([
    source('server.js'),
    source('universal-server.js')
  ]);
  assert.ok((server.match(/session_version = session_version \+ 1/g) || []).length >= 2);
  assert.match(gateway, /Number\(row\.session_version\) !== suppliedVersion/);
  assert.match(server, /terminalSv/);
  assert.match(server, /staffSv/);
});

test('Общий рейтинг учитывает только покупки, активные профили и московский месяц', async () => {
  const [gateway, index] = await Promise.all([
    source('universal-server.js'),
    source('index.html')
  ]);
  assert.match(gateway, /WITH RECURSIVE user_map AS/);
  assert.match(gateway, /um\.canonical_id AS user_id/);
  assert.match(gateway, /t\.status = 'completed'/);
  assert.match(gateway, /t\.mode IN \('accrue','redeem'\)/);
  assert.match(gateway, /u\.merged_into_user_id IS NULL/);
  assert.match(gateway, /Europe\/Moscow/);
  assert.match(gateway, /scope: 'telegram-vk'/);
  assert.match(gateway, /show_name/);
  assert.match(gateway, /show_avatar/);
  assert.match(gateway, /show_leaderboard_amount/);
  assert.match(gateway, /Number\(current\.spend_cents \|\| 0\) > 0/);
  assert.match(index, /Единая лига для Telegram и VK/);
  assert.match(index, /после привязки аккаунтов их покупки суммируются/);
});

test('Loader использует фактическое соотношение сторон и accessibility-режимы', async () => {
  const [css, gateway] = await Promise.all([
    source('loader-fix.css'),
    source('universal-server.js')
  ]);
  assert.match(css, /aspect-ratio:\s*600\s*\/\s*1066/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /background:\s*#000/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /orientation:\s*landscape/);
  assert.match(css, /max-height:\s*560px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(gateway, /loader-fix\.css/);
});

test('CSS: основные стили и loader проходят синтаксический разбор', async () => {
  const [styles, loader] = await Promise.all([
    source('styles.css'),
    source('loader-fix.css')
  ]);
  assert.doesNotThrow(() => parse(styles, { filename: 'styles.css', positions: true }));
  assert.doesNotThrow(() => parse(loader, { filename: 'loader-fix.css', positions: true }));
});

test('VK UI не выполняет глобальную подмену текста Telegram', async () => {
  const vk = await source('vk-platform.js');
  assert.match(vk, /function applyVkLabels/);
  assert.doesNotMatch(vk, /TreeWalker|replaceAll\(['"]Telegram['"]/);
  assert.match(vk, /scannerPlatformHint/);
  assert.match(vk, /platformSwitchHelp/);
});

test('VK-профили не превращаются в Telegram-контакты в админке', async () => {
  const [server, app] = await Promise.all([source('server.js'), source('app.js')]);
  assert.match(server, /AS telegram_username/);
  assert.match(server, /AS vk_id/);
  assert.match(server, /AS vk_username/);
  assert.match(app, /item\.telegramUsername[\s\S]*?https:\/\/t\.me/);
  assert.match(app, /item\.vkId[\s\S]*?https:\/\/vk\.com\/id/);
  assert.match(app, /user\.vkId/);
});

test('Сотрудник вне активной смены не получает рабочую сессию', async () => {
  const server = await source('server.js');
  assert.match(server, /profile\.role !== 'admin'[\s\S]*?!shift[\s\S]*?shift\.members\.some/);
  assert.match(server, /Этот сотрудник не выбран в текущей смене/);
});

test('Повторные миграции защищены реестром, checksum и advisory lock', async () => {
  const gateway = await source('universal-server.js');
  assert.match(gateway, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.match(gateway, /checksum/);
  assert.match(gateway, /pivnik-schema-migrations-v1/);
  assert.match(gateway, /platform_migrations/);
  assert.match(gateway, /MIGRATION_CHECKSUM_UPGRADES/);
  assert.match(gateway, /server\.close\(\(\) => process\.exit\(1\)\)/);
});

test('Достижения считаются по журналу и добавлены в оба профиля', async () => {
  const [achievements, server, gateway, app, migration] = await Promise.all([
    source('achievements.js'),
    source('server.js'),
    source('universal-server.js'),
    source('app.js'),
    source('migrations/002_countable_achievements.sql')
  ]);
  assert.match(achievements, /single-check-1000/);
  assert.match(achievements, /monthly-top-spender/);
  assert.match(achievements, /Europe\/Moscow/);
  assert.match(achievements, /mode IN \('accrue','redeem'\)/);
  assert.match(achievements, /ON CONFLICT \(code, user_id\) DO NOTHING/);
  assert.match(server, /getUserAchievementState/);
  assert.doesNotMatch(gateway, /syncUserAchievements/);
  assert.match(app, /loadAchievements\(\)/);
  assert.match(migration, /'achievement'/);
  assert.match(server, /row\?\.is_creator/);
  assert.match(gateway, /row\?\.is_creator/);
  assert.match(gateway, /achievements: \[\.\.\.achievementsFromRow\(row\), \.\.\.\(startup \? \[\] : achievementState\.earned\)\]/);
});

test('Загрузчик снимается до профиля, начислений и достижений', async () => {
  const [app, accountLink, gateway] = await Promise.all([
    source('app.js'),
    source('account-link.js'),
    source('universal-server.js')
  ]);
  const bootStart = app.indexOf('async function boot()');
  const bootEnd = app.indexOf('async function acceptTerms()', bootStart);
  const bootSource = app.slice(bootStart, bootEnd);
  const finishPosition = bootSource.indexOf('await finishBoot()');
  const backgroundPosition = bootSource.indexOf('schedulePostBootHydration()');

  assert.match(bootSource, /\/api\/bootstrap/);
  assert.ok(finishPosition >= 0 && backgroundPosition > finishPosition);
  assert.doesNotMatch(bootSource, /loadSecondaryData\(/);
  assert.match(app, /async function hydrateAfterBoot\(\)[\s\S]*?\/api\/me[\s\S]*?loadSecondaryData\(\)/);
  assert.match(app, /const jobs = \[[^\]]*loadAchievements\(\)/);
  assert.match(app, /pivnik:boot-complete/);
  assert.match(accountLink, /addEventListener\('pivnik:boot-complete'/);
  assert.doesNotMatch(accountLink, /setTimeout\(\(\) => void loadStatus\(\), 1500\)/);
  assert.match(gateway, /getAppPayload\(userId, provider, \{ startup: true \}\)/);
  assert.match(gateway, /startup\s*\?\s*\[\s*0,\s*\{ earned: \[\], unannounced: \[\] \}/);
  assert.match(gateway, /url\.pathname === '\/api\/bootstrap'/);
});

test('Запуск не открывает правила или профиль, а функции требуют отдельного согласия', async () => {
  const [app, railway, gateway] = await Promise.all([
    source('app.js'),
    source('railway.json'),
    source('universal-server.js')
  ]);
  const bootStart = app.indexOf('async function boot()');
  const bootEnd = app.indexOf('async function acceptTerms()', bootStart);
  const bootSource = app.slice(bootStart, bootEnd);
  const acceptStart = app.indexOf('async function acceptTerms()');
  const acceptEnd = app.indexOf('async function claimBetaTesterReward()', acceptStart);
  const acceptSource = app.slice(acceptStart, acceptEnd);

  assert.doesNotMatch(app, /requiredFirstRunGate|syncFirstRunGate|scheduleConsentGate|openConsentGate/);
  assert.match(bootSource, /await finishBoot\(\)[\s\S]*?closeModal\('consentModal'\)[\s\S]*?closeModal\('profileSetupModal'\)[\s\S]*?schedulePostBootHydration\(\)/);
  assert.doesNotMatch(bootSource, /openModal\('consentModal'\)|openProfileSetup\(/);
  assert.match(app, /function blockUnacceptedAction\(event\)[\s\S]*?state\.profile\?\.termsAccepted[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?openModal\('consentModal'\)/);
  assert.match(app, /document\.addEventListener\('click', blockUnacceptedAction, true\)/);
  assert.match(app, /profileSetupClose'\)\?\.addEventListener\('click', \(\) => closeModal\('profileSetupModal'\)\)/);
  assert.doesNotMatch(acceptSource, /openProfileSetup\(/);
  for (const route of ['status', 'code', 'consume']) {
    const routeStart = gateway.indexOf(`/api/account-link/${route}`);
    const routeEnd = gateway.indexOf('\n    }', routeStart);
    const routeSource = gateway.slice(routeStart, routeEnd);
    assert.match(routeSource, /!user\.termsAccepted[\s\S]*?428/);
  }
  assert.match(railway, /"startCommand": "npm start"/);
  assert.doesNotMatch(railway, /PIVNIK_DOCUMENT_PLATFORM/);
  assert.doesNotMatch(gateway, /PIVNIK_DOCUMENT_PLATFORM|defaultPlatform/);
  assert.match(gateway, /hasVkLaunchParams \|\| hasVkEmbedSource\(headers\) \? 'vk' : 'telegram'/);
  assert.match(gateway, /url\.pathname === '\/vk\/app\.js'/);
  assert.match(gateway, /url\.pathname === '\/vk\/styles\.css'/);
});
