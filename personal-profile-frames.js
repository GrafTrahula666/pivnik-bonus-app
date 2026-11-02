export const GOLD_BARS_FRAME = Object.freeze({ code: 'gold-bars', title: 'Золотая орбитальная рамка' });
export const PERSONAL_FRAME_GIFT_CODE = 'personal-frame-gift-20261002';
const MONEY_FRAME = Object.freeze({ code: 'money', title: 'Долларовая рамка' });
export const REWARD_FRAMES = Object.freeze([
  Object.freeze({ code: 'halloween-pumpkin', title: 'Злые тыквы · Хэллоуин' }),
  Object.freeze({ code: 'infernal-warden', title: 'Адский страж · III место' }),
  Object.freeze({ code: 'frost-tyrant', title: 'Ледяной тиран · II место' }),
  Object.freeze({ code: 'eclipse-sovereign', title: 'Владыка затмения · I место' })
]);
export const CREATOR_FRAME = Object.freeze({ code: 'creator-violet', title: 'CREATOR · Алмазный дракон' });
const REWARD_FRAME_CODES = new Set(REWARD_FRAMES.map((frame) => frame.code));
// Shared by startup repair and both authentication implementations.
export const OWNER_FRAME_REPAIR_SQL = `CASE WHEN profile_frame IN (${[GOLD_BARS_FRAME, ...REWARD_FRAMES, CREATOR_FRAME].map((frame) => `'${frame.code}'`).join(', ')}) THEN profile_frame ELSE 'money' END`;

export function isCreatorFrameOwner(row, ownerTelegramId, ownerVkId) {
  return Boolean(ownerTelegramId && String(row?.telegram_id || row?.telegramId || '') === String(ownerTelegramId))
    || Boolean(ownerVkId && Array.isArray(row?.frame_vk_identity_ids) && row.frame_vk_identity_ids.some((id) => String(id) === String(ownerVkId)));
}

export function selectedRewardFrame(row) {
  const code = String(row?.profile_frame || row?.profileFrame || '');
  return REWARD_FRAME_CODES.has(code) ? code : null;
}
// Frames PIVNIK Business can give to any guest: each has its own animation in styles.css.
export const GRANTABLE_FRAMES = Object.freeze([
  MONEY_FRAME,
  GOLD_BARS_FRAME,
  Object.freeze({ code: 'fire', title: 'Огненная рамка' }),
  Object.freeze({ code: 'diamond', title: 'Алмазная рамка' }),
  ...REWARD_FRAMES
]);
export const GRANTABLE_FRAME_CODES = new Set(GRANTABLE_FRAMES.map((frame) => frame.code));
// Database-owned identities, never request body fields or a generic admin role.
export const FRAME_OWNER_IDENTITY_SQL = `ARRAY(SELECT pfi.provider_user_id FROM user_identities pfi WHERE pfi.user_id = u.id AND pfi.provider = 'vk') AS frame_vk_identity_ids`;
export const PERSONAL_FRAME_OWNERSHIP_SQL = `
  EXISTS(SELECT 1 FROM user_frames pf WHERE pf.user_id = u.id AND pf.frame_id = 'money') AS owns_money_frame,
  EXISTS(SELECT 1 FROM user_frames pf WHERE pf.user_id = u.id AND pf.frame_id = 'gold-bars') AS owns_gold_bars_frame,
  ARRAY(SELECT pf.frame_id FROM user_frames pf WHERE pf.user_id = u.id) AS owned_frame_ids,
  ${FRAME_OWNER_IDENTITY_SQL}`;

// Persisted gifts remain selectable without relying on mutable usernames.
export function giftedFrameChoices(row) {
  const code = String(row?.profile_frame || row?.profileFrame || '');
  const owned = new Set(Array.isArray(row?.owned_frame_ids) ? row.owned_frame_ids : []);
  const choices = [];
  if (row?.owns_money_frame || owned.has('money') || code === 'money') choices.push({ ...MONEY_FRAME });
  if (row?.owns_gold_bars_frame || owned.has('gold-bars') || code === 'gold-bars') choices.push({ ...GOLD_BARS_FRAME });
  if (owned.has('fire')) choices.push({ ...GRANTABLE_FRAMES[2] });
  // The caller already lists a diamond frame bought earlier or currently selected.
  if (owned.has('diamond') && !row?.owns_diamond_frame && code !== 'diamond') choices.push({ ...GRANTABLE_FRAMES[3] });
  for (const frame of REWARD_FRAMES) {
    if (owned.has(frame.code)) choices.push({ ...frame });
  }
  return choices;
}

export async function findSevTroutTelegramId(client) {
  const result = await client.query(`
    SELECT DISTINCT u.id, COALESCE(ui.provider_user_id, u.telegram_id::text) AS telegram_id
    FROM users u LEFT JOIN user_identities ui ON ui.user_id = u.id AND ui.provider = 'telegram'
    WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
      AND COALESCE(ui.provider_user_id, u.telegram_id::text) ~ '^[1-9][0-9]*$'
      AND lower(ltrim(btrim(COALESCE(NULLIF(ui.provider_username, ''), u.username)), '@')) = 'sevtrout'`);
  if (result.rows.length !== 1) throw new Error('@SevTrout must resolve to exactly one active Telegram identity.');
  return String(result.rows[0].telegram_id);
}

export async function grantPersonalTelegramFrames(client, { ownerTelegramId, sevTroutTelegramId, apply = false }) {
  const ownerId = String(ownerTelegramId || '').trim();
  const sevId = String(sevTroutTelegramId || '').trim();
  if (!/^[1-9]\d*$/.test(ownerId) || !/^[1-9]\d*$/.test(sevId) || ownerId === sevId) {
    throw new Error('Two distinct verified Telegram IDs are required.');
  }
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '2500ms'");
    await client.query("SET LOCAL statement_timeout = '6000ms'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('personal-frames-20261002'))");
    const targets = [];
    for (const [telegramId, frameId] of [[ownerId, 'gold-bars'], [sevId, 'money']]) {
      const result = await client.query(`
        SELECT u.id, u.telegram_id, u.username, u.profile_frame
        FROM users u
        WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
          AND (u.telegram_id::text = $1 OR EXISTS (
            SELECT 1 FROM user_identities ui
            WHERE ui.user_id = u.id AND ui.provider = 'telegram' AND ui.provider_user_id = $1
          ))
        FOR UPDATE OF u`, [telegramId]);
      if (result.rows.length !== 1) throw new Error('Telegram identity must resolve to exactly one active user.');
      const row = result.rows[0];
      // Verify the requested handle as well as the durable ID before issuing the gift.
      if (frameId === 'money') {
        const identity = await client.query(`
          SELECT COALESCE(NULLIF(ui.provider_username, ''), u.username) AS username
          FROM users u LEFT JOIN user_identities ui
            ON ui.user_id = u.id AND ui.provider = 'telegram' AND ui.provider_user_id = $2
          WHERE u.id = $1`, [row.id, telegramId]);
        const handle = String(identity.rows[0]?.username || '').trim().replace(/^@/, '').toLowerCase();
        if (handle !== 'sevtrout') throw new Error('The recipient Telegram ID does not belong to @SevTrout.');
      }
      targets.push({ userId: String(row.id), telegramId, username: row.username, previousFrame: row.profile_frame, frameId });
    }
    if (targets[0].userId === targets[1].userId) throw new Error('Recipients must be separate canonical users.');
    if (apply) {
      for (const target of targets) {
        await client.query(`
          INSERT INTO user_frames(user_id, frame_id, acquired_source, restored_from_legacy)
          VALUES($1::bigint, $2, 'personal-gift-20261002', FALSE)
          ON CONFLICT(user_id, frame_id) DO NOTHING`, [target.userId, target.frameId]);
        await client.query(`UPDATE users SET profile_frame = $2, updated_at = NOW()
          WHERE id = $1::bigint AND profile_frame IS DISTINCT FROM $2`, [target.userId, target.frameId]);
        await client.query(`INSERT INTO beta_grants(code, user_id, amount) VALUES($1, $2::bigint, 0)
          ON CONFLICT(code, user_id) DO NOTHING`, [PERSONAL_FRAME_GIFT_CODE, target.userId]);
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { applied: apply, targets };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
