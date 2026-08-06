import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');
const marker = 'Platform separation release safety 2026-08-07';

function replaceRequired(source, from, to, appliedMarker, label) {
  if (source.includes(appliedMarker)) return source;
  if (!source.includes(from)) {
    throw new Error(`Не найден safety-фрагмент platform-separation: ${label}`);
  }
  return source.replace(from, to);
}

function replaceRegionRequired(source, startMarker, endMarker, replacement, appliedMarker, label) {
  if (source.includes(appliedMarker)) return source;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Не найдено начало safety-региона: ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Не найден конец safety-региона: ${label}`);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

let gateway = await fs.readFile(gatewayPath, 'utf8');

const platformDeletion = `// ${marker}. Deletion affects only the platform used for the request.
// A legacy profile that still contains both identities keeps its balance, history,
// QR code and achievements for the other platform. The deleted identity is tombstoned.
async function deletePlatformAccount(userId, platform, providerUserId, confirmation) {
  if (String(confirmation || '').trim().toUpperCase() !== 'УДАЛИТЬ') {
    throw Object.assign(new Error('Введите слово «УДАЛИТЬ» для подтверждения.'), { statusCode: 400 });
  }

  const provider = platform === 'vk' ? 'vk' : platform === 'telegram' ? 'telegram' : null;
  if (!provider) {
    throw Object.assign(new Error('Не удалось определить платформу удаляемого аккаунта.'), { statusCode: 400 });
  }

  const canonical = await canonicalUserId(pool, userId);
  if (!canonical) throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 404 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      \`SELECT id
       FROM users
       WHERE id = $1::bigint
         AND merged_into_user_id IS NULL
         AND deleted_at IS NULL
       FOR UPDATE\`,
      [canonical]
    );
    if (!locked.rowCount) {
      throw Object.assign(new Error('Аккаунт уже удалён или не найден.'), { statusCode: 404 });
    }

    const identities = await client.query(
      \`SELECT provider, provider_user_id, provider_username, profile_url
       FROM user_identities
       WHERE user_id = $1::bigint
       ORDER BY provider
       FOR UPDATE\`,
      [canonical]
    );
    const requestedProviderUserId = String(providerUserId || '');
    const deletingIdentity = identities.rows.find((identity) => (
      identity.provider === provider
      && (!requestedProviderUserId || String(identity.provider_user_id) === requestedProviderUserId)
    )) || identities.rows.find((identity) => identity.provider === provider);

    if (!deletingIdentity) {
      throw Object.assign(new Error('Аккаунт этой платформы уже удалён или не найден.'), { statusCode: 404 });
    }

    const storeTombstone = async (identity) => {
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
    };

    const remainingIdentities = identities.rows.filter((identity) => !(
      identity.provider === deletingIdentity.provider
      && String(identity.provider_user_id) === String(deletingIdentity.provider_user_id)
    ));

    if (remainingIdentities.length) {
      await storeTombstone(deletingIdentity);
      await client.query(
        'DELETE FROM account_link_codes WHERE user_id = $1::bigint OR used_by_user_id = $1::bigint',
        [canonical]
      );
      await client.query('DELETE FROM account_link_attempts WHERE user_id = $1::bigint', [canonical]);
      await client.query(
        \`DELETE FROM user_identities
         WHERE user_id = $1::bigint
           AND provider = $2
           AND provider_user_id = $3\`,
        [canonical, deletingIdentity.provider, deletingIdentity.provider_user_id]
      );

      const remaining = remainingIdentities[0];
      await client.query(
        \`UPDATE users SET
           telegram_id = CASE WHEN $2 = 'telegram' THEN $3::bigint ELSE NULL END,
           username = $4,
           first_name = CASE WHEN $2 = 'telegram' THEN 'Пользователь Telegram' ELSE 'Пользователь VK' END,
           last_name = NULL,
           photo_url = $5,
           language_code = NULL,
           session_version = session_version + 1,
           updated_at = NOW()
         WHERE id = $1::bigint\`,
        [
          canonical,
          remaining.provider,
          remaining.provider_user_id,
          remaining.provider_username || null,
          remaining.profile_url || null
        ]
      );

      await client.query('COMMIT');
      return {
        ok: true,
        deleted: true,
        platform: provider,
        preservedOtherPlatform: true
      };
    }

    for (const identity of identities.rows) await storeTombstone(identity);

    await client.query('DELETE FROM account_link_codes WHERE user_id = $1::bigint OR used_by_user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM account_link_attempts WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM user_identities WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM bar_customers WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM reward_grants WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM beta_grants WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM qr_aliases WHERE user_id = $1::bigint OR source_user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM qr_sessions WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM shift_members WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM cancel_quota_resets WHERE user_id = $1::bigint OR reset_by = $1::bigint', [canonical]);
    await client.query('DELETE FROM shop_inquiries WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM wallets WHERE user_id = $1::bigint', [canonical]);
    await client.query('DELETE FROM beer_loyalty WHERE user_id = $1::bigint', [canonical]);
    await client.query('UPDATE shifts SET created_by = NULL WHERE created_by = $1::bigint', [canonical]);
    await client.query('UPDATE app_settings SET updated_by = NULL WHERE updated_by = $1::bigint', [canonical]);
    await client.query('UPDATE promotions SET updated_by = NULL WHERE updated_by = $1::bigint', [canonical]);
    await client.query('UPDATE shop_items SET updated_by = NULL WHERE updated_by = $1::bigint', [canonical]);

    await client.query(
      \`UPDATE users SET
         telegram_id = NULL,
         username = NULL,
         first_name = 'Удалённый пользователь',
         last_name = NULL,
         photo_url = NULL,
         language_code = NULL,
         role = 'client',
         qr_token = NULL,
         qr_short_code = NULL,
         staff_pin_hash = NULL,
         staff_pin_salt = NULL,
         staff_pin_updated_at = NULL,
         avatar_source = 'preset_male',
         avatar_key = NULL,
         profile_frame = 'none',
         age_group = NULL,
         profile_public = FALSE,
         show_name = FALSE,
         show_avatar = FALSE,
         show_leaderboard_amount = FALSE,
         show_stats = FALSE,
         unlimited_bonus = FALSE,
         onboarding_completed_at = NULL,
         terms_accepted_at = NULL,
         terms_version = NULL,
         session_version = session_version + 1,
         deleted_at = NOW(),
         updated_at = NOW()
       WHERE id = $1::bigint\`,
      [canonical]
    );
    await client.query('COMMIT');
    return { ok: true, deleted: true, platform: provider, preservedOtherPlatform: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

`;

gateway = replaceRegionRequired(
  gateway,
  'async function deleteUnifiedAccount(userId, confirmation) {',
  'async function getUnifiedAdminUsers() {',
  platformDeletion,
  marker,
  'платформенное удаление аккаунта'
);

gateway = replaceRequired(
  gateway,
  `      const body = parseJsonBody(await readRequestBody(req));
      return sendJson(res, 200, await deleteUnifiedAccount(user.id, body.confirmation));`,
  `      const body = parseJsonBody(await readRequestBody(req));
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(
        res,
        200,
        await deletePlatformAccount(user.id, platform, user.payload.pid, body.confirmation)
      );`,
  'deletePlatformAccount(user.id, platform, user.payload.pid, body.confirmation)',
  'маршрут платформенного удаления'
);

gateway = replaceRequired(
  gateway,
  `        vkConfigured: Boolean(vkAppId && vkAppSecret),
        ...publicReleaseMetadata(),`,
  `        vkConfigured: Boolean(vkAppId && vkAppSecret),
        unifiedAccounts: false,
        accountMode: PLATFORM_ACCOUNT_MODE,
        linkCodes: false,
        ...publicReleaseMetadata(),`,
  `vkConfigured: Boolean(vkAppId && vkAppSecret),
        unifiedAccounts: false,
        accountMode: PLATFORM_ACCOUNT_MODE,
        linkCodes: false,`,
  'release-readiness отдельных аккаунтов'
);

for (const required of [
  marker,
  'async function deletePlatformAccount(',
  'preservedOtherPlatform: true',
  'deletePlatformAccount(user.id, platform, user.payload.pid, body.confirmation)',
  "accountMode: PLATFORM_ACCOUNT_MODE",
  'linkCodes: false'
]) {
  if (!gateway.includes(required)) {
    throw new Error(`Platform separation safety verification failed: ${required}`);
  }
}
if (gateway.includes('await deleteUnifiedAccount(user.id, body.confirmation)')) {
  throw new Error('Старый маршрут удаления объединённого аккаунта всё ещё активен.');
}

await fs.writeFile(gatewayPath, gateway, 'utf8');
console.log('Platform separation release safety is applied and verified.');
