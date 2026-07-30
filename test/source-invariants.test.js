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
  assert.doesNotMatch(gateway, /unpkg|cdn\.jsdelivr/i);
});

test('VK запускается через подписанный ID и очищает сессию каждого VK-аккаунта', async () => {
  const vk = await source('vk-platform.js');
  const initPosition = vk.indexOf("VKWebAppInit");
  const userPosition = vk.indexOf("VKWebAppGetUserInfo");
  assert.ok(initPosition >= 0 && userPosition > initPosition);
  assert.match(vk, /BRIDGE_INIT_TIMEOUT_MS/);
  assert.match(vk, /BRIDGE_PROFILE_TIMEOUT_MS/);
  assert.doesNotMatch(vk, /waitForBridge/);
  assert.match(vk, /launchVkUserId/);
  assert.match(vk, /String\(vkUser\.id\) !== launchVkUserId/);
  assert.match(vk, /pivnik_vk_\$\{launchVkUserId \|\| 'unknown'\}_/);
  assert.match(vk, /code_data \|\| data\?\.code/);
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
  assert.match(server, /x-pivnik-explicit-consent/);
  assert.match(gateway, /x-pivnik-explicit-consent/);
  assert.match(gateway, /grantReward\([\s\S]*?'welcome-100'/);
  assert.match(server, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, NULL, NULL, NULL\)/);
  assert.doesNotMatch(server, /ensureUserSetupDefaults/);
});

test('Миграция создаёт идентичности, награды, aliases, аудит и версии сессий', async () => {
  const migration = await source('migrations/001_add_platform_identities.sql');
  assert.match(migration, /UNIQUE \(provider, provider_user_id\)/);
  assert.match(migration, /UNIQUE \(user_id, provider\)/);
  assert.match(migration, /PRIMARY KEY \(code, user_id\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS qr_aliases/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS account_merge_audit/);
  assert.match(migration, /session_version BIGINT NOT NULL DEFAULT 1/);
  assert.match(migration, /idx_transactions_leaderboard/);
  assert.match(migration, /idx_transactions_cancel_request_key/);
});

test('Объединение блокирует строки, переносит связи, архивирует дубль и сверяет журнал', async () => {
  const [gateway, server] = await Promise.all([
    source('universal-server.js'),
    source('server.js')
  ]);
  assert.match(gateway, /ORDER BY id FOR UPDATE/);
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
  const gateway = await source('universal-server.js');
  assert.match(gateway, /t\.status = 'completed'/);
  assert.match(gateway, /t\.mode IN \('accrue','redeem'\)/);
  assert.match(gateway, /u\.merged_into_user_id IS NULL/);
  assert.match(gateway, /Europe\/Moscow/);
  assert.match(gateway, /show_name/);
  assert.match(gateway, /show_avatar/);
  assert.match(gateway, /show_leaderboard_amount/);
  assert.match(gateway, /Number\(current\.spend_cents \|\| 0\) > 0/);
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
});
