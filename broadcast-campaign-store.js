import crypto from 'node:crypto';

export const BROADCAST_DEDUPE_WINDOW_MINUTES = 10;

const ALLOWED_CHANNELS = new Set(['telegram', 'vk', 'all']);
const ALLOWED_AUDIENCES = new Set(['clients', 'all']);

function positiveIntegerId(value, name) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || BigInt(text) <= 0n) {
    throw new TypeError(`${name} must be a positive integer identifier`);
  }
  return text;
}

function safeCount(value) {
  const count = Number(value || 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function safeErrorCode(error) {
  const candidate = String(error?.code || 'broadcast_failed').trim();
  return /^[a-z0-9_.:-]{1,80}$/i.test(candidate) ? candidate : 'broadcast_failed';
}

// Store only bounded aggregate machine codes, never provider text or recipients.
function deliveryErrors(value, failed, channel) {
  if (!Array.isArray(value)) return null;
  const errors = new Map();
  let remaining = safeCount(failed);
  for (const entry of value.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const count = Math.min(safeCount(entry.count), remaining);
    if (!count) continue;
    const candidate = typeof entry.error === 'string' ? entry.error : '';
    const known = channel === 'telegram'
      ? /^(?:telegram_not_configured|telegram_send_failed|telegram_network_error|telegram_invalid_response)$/
      : /^(?:vk_not_configured|vk_send_failed|vk_network_error|vk_[0-9]{1,6})$/;
    const error = known.test(candidate) ? candidate : `${channel}_send_failed`;
    errors.set(error, (errors.get(error) || 0) + count);
    remaining -= count;
  }
  return Object.freeze([...errors].map(([error, count]) => Object.freeze({ error, count })));
}

export function hashBroadcastMessage(message) {
  return crypto.createHash('sha256').update(String(message ?? ''), 'utf8').digest('hex');
}

export function broadcastCampaignFingerprint({ channel, audience, message }) {
  if (!ALLOWED_CHANNELS.has(channel)) throw new TypeError('invalid broadcast channel');
  if (!ALLOWED_AUDIENCES.has(audience)) throw new TypeError('invalid broadcast audience');
  const messageHash = hashBroadcastMessage(message);
  return {
    messageHash,
    fingerprint: crypto
      .createHash('sha256')
      .update(`${channel}\n${audience}\n${messageHash}`, 'utf8')
      .digest('hex')
  };
}

function campaignResponse(row) {
  if (!row) return null;
  return Object.freeze({
    id: String(row.id),
    status: String(row.status),
    channel: String(row.channel),
    audience: String(row.audience),
    actorUserId: String(row.actor_user_id),
    totalUsers: safeCount(row.total_users),
    truncated: row.truncated === true,
    telegram: Object.freeze({
      attempted: safeCount(row.telegram_attempted),
      delivered: safeCount(row.telegram_delivered),
      failed: safeCount(row.telegram_failed),
      errors: deliveryErrors(row.telegram_errors, row.telegram_failed, 'telegram')
    }),
    vk: Object.freeze({
      attempted: safeCount(row.vk_attempted),
      delivered: safeCount(row.vk_delivered),
      failed: safeCount(row.vk_failed),
      errors: deliveryErrors(row.vk_errors, row.vk_failed, 'vk')
    }),
    createdAt: row.created_at || null,
    completedAt: row.completed_at || null,
    errorCode: row.error_code || null
  });
}

export function createBroadcastCampaignStore(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('pool with query/connect is required');
  }

  async function ensureSchema(query = pool.query.bind(pool)) {
    await query(`
      CREATE TABLE IF NOT EXISTS broadcast_campaigns (
        id BIGSERIAL PRIMARY KEY,
        actor_user_id BIGINT NOT NULL REFERENCES users(id),
        channel TEXT NOT NULL CHECK (channel IN ('telegram','vk','all')),
        audience TEXT NOT NULL CHECK (audience IN ('clients','all')),
        message_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
        total_users INTEGER NOT NULL DEFAULT 0 CHECK (total_users >= 0),
        truncated BOOLEAN NOT NULL DEFAULT FALSE,
        telegram_attempted INTEGER NOT NULL DEFAULT 0 CHECK (telegram_attempted >= 0),
        telegram_delivered INTEGER NOT NULL DEFAULT 0 CHECK (telegram_delivered >= 0),
        telegram_failed INTEGER NOT NULL DEFAULT 0 CHECK (telegram_failed >= 0),
        vk_attempted INTEGER NOT NULL DEFAULT 0 CHECK (vk_attempted >= 0),
        vk_delivered INTEGER NOT NULL DEFAULT 0 CHECK (vk_delivered >= 0),
        vk_failed INTEGER NOT NULL DEFAULT 0 CHECK (vk_failed >= 0),
        telegram_errors JSONB,
        vk_errors JSONB,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);
    // Existing campaigns retain NULL: their original failure reasons are unknown.
    await query(`ALTER TABLE broadcast_campaigns
      ADD COLUMN IF NOT EXISTS telegram_errors JSONB,
      ADD COLUMN IF NOT EXISTS vk_errors JSONB`);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_fingerprint_created
      ON broadcast_campaigns (fingerprint, created_at DESC)
    `);
  }

  async function claim({ actorUserId, channel, audience, message, totalUsers, truncated }) {
    const actorId = positiveIntegerId(actorUserId, 'actorUserId');
    const { messageHash, fingerprint } = broadcastCampaignFingerprint({ channel, audience, message });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`broadcast-campaign:${fingerprint}`]
      );
      const existing = await client.query(
        `SELECT *
         FROM broadcast_campaigns
         WHERE fingerprint = $1
           AND created_at >= NOW() - INTERVAL '${BROADCAST_DEDUPE_WINDOW_MINUTES} minutes'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [fingerprint]
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return Object.freeze({ created: false, campaign: campaignResponse(existing.rows[0]) });
      }

      const inserted = await client.query(
        `INSERT INTO broadcast_campaigns (
           actor_user_id, channel, audience, message_hash, fingerprint,
           status, total_users, truncated
         ) VALUES ($1::bigint, $2, $3, $4, $5, 'processing', $6, $7)
         RETURNING *`,
        [actorId, channel, audience, messageHash, fingerprint, safeCount(totalUsers), truncated === true]
      );
      await client.query('COMMIT');
      return Object.freeze({ created: true, campaign: campaignResponse(inserted.rows[0]) });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function complete(campaignId, { telegram = {}, vk = {} } = {}) {
    const id = positiveIntegerId(campaignId, 'campaignId');
    const result = await pool.query(
      `UPDATE broadcast_campaigns
       SET status = 'completed',
           telegram_attempted = $2,
           telegram_delivered = $3,
           telegram_failed = $4,
           vk_attempted = $5,
           vk_delivered = $6,
           vk_failed = $7,
           telegram_errors = $8::jsonb,
           vk_errors = $9::jsonb,
           error_code = NULL,
           completed_at = NOW()
       WHERE id = $1::bigint
       RETURNING *`,
      [
        id,
        safeCount(telegram.attempted),
        safeCount(telegram.delivered),
        safeCount(telegram.failed),
        safeCount(vk.attempted),
        safeCount(vk.delivered),
        safeCount(vk.failed),
        JSON.stringify(deliveryErrors(telegram.errors, telegram.failed, 'telegram')),
        JSON.stringify(deliveryErrors(vk.errors, vk.failed, 'vk'))
      ]
    );
    if (!result.rowCount) throw new Error('broadcast campaign audit row not found');
    return campaignResponse(result.rows[0]);
  }

  async function fail(campaignId, error) {
    const id = positiveIntegerId(campaignId, 'campaignId');
    const result = await pool.query(
      `UPDATE broadcast_campaigns
       SET status = 'failed',
           error_code = $2,
           completed_at = NOW()
       WHERE id = $1::bigint
       RETURNING *`,
      [id, safeErrorCode(error)]
    );
    return campaignResponse(result.rows[0]);
  }

  return Object.freeze({ ensureSchema, claim, complete, fail });
}
