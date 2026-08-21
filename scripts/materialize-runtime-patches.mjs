import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const bootstrapVladPath = path.join(root, 'bootstrap-vlad.js');
const bootstrapPath = path.join(root, 'bootstrap.js');
const markerPath = path.join(root, '.pivnik-materialized');

const FINAL_START_COMMAND = 'node universal-server.js';
const BOOTSTRAP_IMPORT = "await import('./bootstrap.js');";
const MATERIALIZED_BOOTSTRAP_IMPORT = `const preparedBootstrapSource = await fs.readFile(bootstrapPath, 'utf8');
const serverImport = "await import('./universal-server.js');";
if (preparedBootstrapSource.includes(serverImport)) {
  await fs.writeFile(
    bootstrapPath,
    preparedBootstrapSource.replace(
      serverImport,
      "if (process.env.PIVNIK_PATCH_ONLY !== '1') await import('./universal-server.js');"
    ),
    'utf8'
  );
}
process.env.PIVNIK_PATCH_ONLY = '1';
await import('./bootstrap.js');`;

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function write(relativePath, content) {
  await fs.writeFile(path.join(root, relativePath), content, 'utf8');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) {
    throw new Error(`Не найден фрагмент release-hardening: ${label}`);
  }
  return source.replace(from, to);
}

function replacePatternRequired(source, pattern, replacement, marker, label) {
  if (source.includes(marker)) return source;
  if (!pattern.test(source)) {
    throw new Error(`Не найден фрагмент release-hardening: ${label}`);
  }
  return source.replace(pattern, replacement);
}

async function applyReleaseHardening() {
  let index = await read('index.html');
  index = replacePatternRequired(
    index,
    /(<button\b[^>]*\bid="acceptTerms"[^>]*>[\s\S]*?<\/button>)/,
    `$1\n      <button class="text-link danger-text" id="deleteAccountFromConsent" type="button">Удалить аккаунт без принятия правил</button>`,
    'id="deleteAccountFromConsent"',
    'кнопка удаления до принятия правил'
  );
  await write('index.html', index);

  let app = await read('app.js');
  app = replaceRequired(
    app,
    `function blockUnacceptedAction(event) {
  if (state.profile?.termsAccepted) return;
  const interactive = event.target?.closest?.(
    '#appShell button, #appShell a, #appShell input, #appShell select, #appShell textarea, #appShell [role="button"]'
  );
  if (!interactive) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openModal('consentModal');
}`,
    `function blockUnacceptedAction(event) {
  if (state.profile?.termsAccepted) return;
  const consentSafeTarget = event.target?.closest?.(
    '#consentModal, #helpModal, #deleteAccountModal, #deleteAccountFromConsent'
  );
  if (consentSafeTarget) return;
  const interactive = event.target?.closest?.(
    '#appShell button, #appShell a, #appShell input, #appShell select, #appShell textarea, #appShell [role="button"]'
  );
  if (!interactive) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openModal('consentModal');
}`,
    'исключения для удаления аккаунта без согласия'
  );
  app = replaceRequired(
    app,
    `$('#openDeleteAccount')?.addEventListener('click', () => { if ($('#deleteAccountConfirm')) $('#deleteAccountConfirm').value = ''; if ($('#deleteAccountButton')) $('#deleteAccountButton').disabled = true; openModal('deleteAccountModal'); });`,
    `$('#openDeleteAccount')?.addEventListener('click', () => { if ($('#deleteAccountConfirm')) $('#deleteAccountConfirm').value = ''; if ($('#deleteAccountButton')) $('#deleteAccountButton').disabled = true; openModal('deleteAccountModal'); });
$('#deleteAccountFromConsent')?.addEventListener('click', () => { if ($('#deleteAccountConfirm')) $('#deleteAccountConfirm').value = ''; if ($('#deleteAccountButton')) $('#deleteAccountButton').disabled = true; closeModal('consentModal'); openModal('deleteAccountModal'); });`,
    'обработчик удаления из consent-экрана'
  );
  await write('app.js', app);

  let gateway = await read('universal-server.js');
  gateway = replaceRequired(
    gateway,
    `async function acceptConsent(userId, platform) {`,
    `function deletedIdentityHash(provider, providerUserId) {
  return crypto
    .createHmac('sha256', identityTombstoneSecret)
    .update(\`deleted-identity:\${provider}:\${providerUserId}\`)
    .digest('hex');
}

async function hasDeletedIdentity(db, userId) {
  const identities = await db.query(
    'SELECT provider, provider_user_id FROM user_identities WHERE user_id = $1::bigint',
    [userId]
  );
  for (const identity of identities.rows) {
    const tombstone = await db.query(
      'SELECT 1 FROM deleted_identity_tombstones WHERE provider = $1 AND identity_hash = $2 LIMIT 1',
      [identity.provider, deletedIdentityHash(identity.provider, identity.provider_user_id)]
    );
    if (tombstone.rowCount) return true;
  }
  return false;
}

async function acceptConsent(userId, platform) {`,
    'проверка удалённых идентичностей'
  );
  gateway = replaceRequired(
    gateway,
    `    const canonical = await canonicalUserId(client, userId);
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [canonical]);
    await client.query(
      \`UPDATE users`,
    `    const canonical = await canonicalUserId(client, userId);
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [canonical]);
    const rewardEligible = !(await hasDeletedIdentity(client, canonical));
    await client.query(
      \`UPDATE users`,
    'запрет повторных стартовых наград'
  );
  gateway = replaceRequired(
    gateway,
    `    const reward = await grantReward(
      client,
      canonical,
      'welcome-100',
      WELCOME_BONUS,
      'consent',
      'Приветственный бонус за регистрацию',
      'welcome'
    );`,
    `    const reward = rewardEligible
      ? await grantReward(
          client,
          canonical,
          'welcome-100',
          WELCOME_BONUS,
          'consent',
          'Приветственный бонус за регистрацию',
          'welcome'
        )
      : { granted: false, amount: 0 };`,
    'условная приветственная награда'
  );
  if (!gateway.includes('initializeAchievementGrants')) {
    gateway = replaceRequired(
      gateway,
      `    if (betaNumber > 0 && betaNumber <= 30) {
      betaReward = await grantReward(`,
      `    if (rewardEligible && betaNumber > 0 && betaNumber <= 30) {
      betaReward = await grantReward(`,
      'условная beta-награда'
    );
    gateway = replaceRequired(
      gateway,
      `    const canonical = await canonicalUserId(client, userId);
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [canonical]);

    const userResult = await client.query(
      \`SELECT terms_accepted_at, terms_version,`,
      `    const canonical = await canonicalUserId(client, userId);
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [canonical]);
    if (await hasDeletedIdentity(client, canonical)) {
      await client.query('COMMIT');
      return { eligible: false, granted: false, profile: await getProfile(canonical, platform) };
    }

    const userResult = await client.query(
      \`SELECT terms_accepted_at, terms_version,`,
      'запрет ручного получения beta-награды после удаления'
    );
  }
  gateway = replaceRequired(
    gateway,
    `    await client.query('DELETE FROM account_link_codes WHERE user_id = $1::bigint OR used_by_user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM account_link_attempts WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM user_identities WHERE user_id = $1::bigint', [canonical]);`,
    `    const deletingIdentities = await client.query(
      'SELECT provider, provider_user_id FROM user_identities WHERE user_id = $1::bigint FOR UPDATE',
      [canonical]
    );
    for (const identity of deletingIdentities.rows) {
      await client.query(
        \`INSERT INTO deleted_identity_tombstones (
           provider, identity_hash, deleted_user_id, deleted_at
         ) VALUES ($1, $2, $3::bigint, NOW())
         ON CONFLICT (provider, identity_hash) DO UPDATE
         SET deleted_user_id = EXCLUDED.deleted_user_id,
             deleted_at = EXCLUDED.deleted_at\`,
        [
          identity.provider,
          deletedIdentityHash(identity.provider, identity.provider_user_id),
          canonical
        ]
      );
    }

    await client.query('DELETE FROM account_link_codes WHERE user_id = $1::bigint OR used_by_user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM account_link_attempts WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM user_identities WHERE user_id = $1::bigint', [canonical]);`,
    'фиксация hash tombstone перед удалением identity'
  );
  gateway = replaceRequired(
    gateway,
    `    if (req.method === 'DELETE' && url.pathname === '/api/me/account') {
      const user = await requireGatewayUser(req);
      if (!user.termsAccepted) {
        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
      }
      const body = parseJsonBody(await readRequestBody(req));`,
    `    if (req.method === 'DELETE' && url.pathname === '/api/me/account') {
      const user = await requireGatewayUser(req);
      const body = parseJsonBody(await readRequestBody(req));`,
    'удаление аккаунта без обязательного принятия правил'
  );
  await write('universal-server.js', gateway);
}

async function verifyMaterializedState() {
  const [pkgText, app, gateway, styles, index, deletionMigration, wheelMigration] = await Promise.all([
    fs.readFile(packagePath, 'utf8'),
    read('app.js'),
    read('universal-server.js'),
    read('styles.css'),
    read('index.html'),
    read('migrations/004_deleted_identity_tombstones.sql'),
    read('migrations/006_telegram_wheel.sql')
  ]);
  const pkg = JSON.parse(pkgText);
  const failures = [];
  if (pkg.scripts?.start !== FINAL_START_COMMAND) failures.push('package.json start');
  if (!app.includes("const APP_VERSION = '21.0-referral-v2.1';")) failures.push('app.js version');
  if (!app.includes("profileFrame === 'vladislav'")) failures.push('app.js Vladislav frame');
  if (!app.includes('consentSafeTarget')) failures.push('consent-safe deletion');
  if (!gateway.includes('vladislavTelegramId')) failures.push('universal-server.js Vladislav identity');
  if (!gateway.includes("storedFrame === 'olesya'")) failures.push('universal-server.js Olesya frame');
  if (!gateway.includes('deletedIdentityHash')) failures.push('deleted identity reward guard');
  if (!styles.includes('avatar-frame-vladislav')) failures.push('styles.css Vladislav frame');
  if (!index.includes('styles.css?v=21.0-referral-v2.1')) failures.push('index.html asset version');
  if (!index.includes('deleteAccountFromConsent')) failures.push('consent account deletion button');
  if (!deletionMigration.includes('identity_hash')) failures.push('deleted identity migration');
  if (!app.includes('WHEEL_VISUAL_SECTORS')) failures.push('app.js wheel artwork');
  if (!gateway.includes("url.pathname === '/api/wheel/status'")) failures.push('wheel status endpoint');
  if (!gateway.includes("url.pathname === '/api/wheel/spin'")) failures.push('wheel spin endpoint');
  if (!gateway.includes("const PLATFORM_ACCOUNT_MODE = 'separate';")) failures.push('separate platform accounts');
  if (!gateway.includes('linkCodes: false')) failures.push('disabled account linking');
  if (!gateway.includes('/vk-platform.js?v=3.2.2-anna-consent-persistence')) failures.push('VK client cache version');
  if (!index.includes('id="openWheelButton"')) failures.push('Telegram wheel entry');
  if (!index.includes('id="wheelSpinButton"')) failures.push('Telegram wheel screen');
  if (!wheelMigration.includes('CREATE TABLE IF NOT EXISTS wheel_spins')) failures.push('wheel migration');
  if (failures.length) {
    throw new Error(`Материализация релиза неполная: ${failures.join(', ')}`);
  }
}

async function alreadyMaterialized() {
  try {
    await verifyMaterializedState();
    return true;
  } catch {
    return false;
  }
}

if (!(await alreadyMaterialized())) {
  let bootstrapVlad = await fs.readFile(bootstrapVladPath, 'utf8');
  if (!bootstrapVlad.includes(MATERIALIZED_BOOTSTRAP_IMPORT)) {
    const importPosition = bootstrapVlad.lastIndexOf(BOOTSTRAP_IMPORT);
    if (importPosition < 0) {
      throw new Error('Не найден финальный импорт bootstrap.js для безопасной материализации.');
    }
    bootstrapVlad = `${bootstrapVlad.slice(0, importPosition)}${MATERIALIZED_BOOTSTRAP_IMPORT}${bootstrapVlad.slice(importPosition + BOOTSTRAP_IMPORT.length)}`;
    await fs.writeFile(bootstrapVladPath, bootstrapVlad, 'utf8');
  }

  process.env.PIVNIK_PATCH_ONLY = '1';
  await import(`${pathToFileURL(bootstrapVladPath).href}?materialize=${Date.now()}`);

  const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  pkg.scripts = { ...(pkg.scripts || {}), start: FINAL_START_COMMAND };
  await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

await applyReleaseHardening();
await verifyMaterializedState();
await fs.writeFile(
  markerPath,
  `${JSON.stringify({ materializedAt: new Date().toISOString(), start: FINAL_START_COMMAND })}\n`,
  'utf8'
);

console.log('Pivnik release sources are materialized and verified.');
