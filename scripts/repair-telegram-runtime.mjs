import pg from 'pg';

const { Client } = pg;
const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const serviceName = String(process.env.RAILWAY_SERVICE_NAME || '').toLowerCase();
const documentPlatform = String(process.env.PIVNIK_DOCUMENT_PLATFORM || '').toLowerCase();
const isVkService = documentPlatform === 'vk' || serviceName.includes('vk');
const appUrl = String(process.env.TELEGRAM_APP_URL || process.env.PIVNIK_APP_URL || '').trim().replace(/\/+$/, '');
const testQrToken = 'TESTCLIENT20260819PIVNIK';
const testQrShort = 'PVK-TEST-2026';
const releaseCanaries = Object.freeze([
  Object.freeze({
    provider: 'telegram',
    providerId: '900000000000001',
    username: 'pivnik_release_telegram',
    firstName: 'Тест Telegram',
    qrToken: 'PIVNIKRELEASETELEGRAM20260824',
    qrShort: 'PVK-REL-TG24'
  }),
  Object.freeze({
    provider: 'vk',
    providerId: '2147483001',
    username: 'pivnik_release_vk',
    firstName: 'Тест VK',
    qrToken: 'PIVNIKRELEASEVK20260824',
    qrShort: 'PVK-REL-VK24'
  })
]);

async function telegramApi(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(`Telegram ${method} failed: ${body?.description || `HTTP ${response.status}`}`);
  }
  return body.result;
}

if (!isVkService && botToken && /^https:\/\//i.test(appUrl)) {
  await telegramApi('deleteWebhook', { drop_pending_updates: false });
  await telegramApi('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Открыть ПРИЛОЖЕНИЕ',
      web_app: { url: appUrl }
    }
  });
  await telegramApi('deleteMyCommands', {});
  console.log(`Telegram bot menu repaired: ${appUrl}`);
} else if (!isVkService && botToken) {
  console.log('Telegram menu repair skipped because TELEGRAM_APP_URL/PIVNIK_APP_URL is not explicitly configured.');
} else {
  console.log('Telegram menu repair skipped for non-Telegram runtime or missing token.');
}

if (databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('railway.internal') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
    statement_timeout: 30_000
  });
  await client.connect();
  try {
    const schema = await client.query("SELECT to_regclass('public.users') AS users_table");
    if (!schema.rows[0]?.users_table) {
      console.log('Test client seed skipped because the fresh database schema has not been initialized yet.');
    } else {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('pivnik:test-client:20260819'))");
      let result = await client.query(
        'SELECT id FROM users WHERE qr_token = $1 AND merged_into_user_id IS NULL LIMIT 1',
        [testQrToken]
      );
      if (!result.rowCount) {
        result = await client.query(`
          INSERT INTO users (
            username, first_name, role, qr_token, qr_short_code,
            terms_accepted_at, terms_version, onboarding_completed_at,
            profile_public, show_name, show_avatar, show_leaderboard_amount, show_stats
          ) VALUES (
            'pivnik_test_client', 'Тест Пивника', 'client', $1, $2,
            NOW(), '2026-08-08', NOW(),
            FALSE, TRUE, FALSE, FALSE, FALSE
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `, [testQrToken, testQrShort]);
        if (!result.rowCount) {
          result = await client.query(
            'SELECT id FROM users WHERE qr_token = $1 AND merged_into_user_id IS NULL LIMIT 1',
            [testQrToken]
          );
        }
      }
      if (!result.rowCount) throw new Error('Could not create or resolve Pivnik test client.');
      const userId = result.rows[0].id;
      await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [userId]);
      await client.query('INSERT INTO beer_loyalty (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);

      for (const canary of releaseCanaries) {
        let canaryUser = await client.query(
          'SELECT id FROM users WHERE qr_token = $1 AND merged_into_user_id IS NULL LIMIT 1',
          [canary.qrToken]
        );
        if (!canaryUser.rowCount) {
          canaryUser = await client.query(`
            INSERT INTO users (
              telegram_id, username, first_name, role, qr_token, qr_short_code,
              terms_accepted_at, terms_version, onboarding_completed_at,
              profile_public, show_name, show_avatar, show_leaderboard_amount, show_stats
            ) VALUES (
              $1, $2, $3, 'client', $4, $5,
              NOW(), '2026-08-04', NOW(),
              FALSE, TRUE, FALSE, FALSE, FALSE
            )
            RETURNING id
          `, [
            canary.provider === 'telegram' ? canary.providerId : null,
            canary.username,
            canary.firstName,
            canary.qrToken,
            canary.qrShort
          ]);
        }
        if (!canaryUser.rowCount) throw new Error(`Could not create ${canary.provider} release canary.`);
        const canaryUserId = canaryUser.rows[0].id;
        await client.query(`
          UPDATE users
             SET telegram_id = CASE WHEN $2 = 'telegram' THEN $3::bigint ELSE NULL END,
                 username = $4,
                 first_name = $5,
                 last_name = NULL,
                 photo_url = NULL,
                 language_code = 'ru',
                 role = 'client',
                 terms_accepted_at = COALESCE(terms_accepted_at, NOW()),
                 terms_version = '2026-08-04',
                 onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()),
                 profile_public = FALSE,
                 show_avatar = FALSE,
                 show_leaderboard_amount = FALSE,
                 show_stats = FALSE,
                 updated_at = NOW()
           WHERE id = $1
        `, [canaryUserId, canary.provider, canary.providerId, canary.username, canary.firstName]);
        await client.query(
          'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
          [canaryUserId]
        );
        await client.query(
          'INSERT INTO beer_loyalty (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
          [canaryUserId]
        );
        await client.query(`
          INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (provider, provider_user_id) DO UPDATE
             SET provider_username = EXCLUDED.provider_username,
                 updated_at = NOW()
           WHERE user_identities.user_id = EXCLUDED.user_id
        `, [canaryUserId, canary.provider, canary.providerId, canary.username]);
        const identity = await client.query(`
          SELECT user_id
            FROM user_identities
           WHERE provider = $1 AND provider_user_id = $2
        `, [canary.provider, canary.providerId]);
        if (String(identity.rows[0]?.user_id || '') !== String(canaryUserId)) {
          throw new Error(`${canary.provider} release canary identity belongs to another user.`);
        }
      }
      await client.query('COMMIT');
      console.log(`Pivnik test client ready: user=${userId}, short=${testQrShort}; release canaries=2`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
} else {
  console.log('Test client seed skipped because DATABASE_URL is unavailable.');
}
