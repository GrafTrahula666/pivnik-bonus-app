import crypto from 'node:crypto';
import {
  createBootstrapToken,
  createDeviceToken,
  createPairCode,
  hashDeviceSecret,
  normalizeDeviceLabel,
  normalizePairCode,
  safePublicDevice
} from './device-auth-core.js';

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

export function createDeviceAuthPersistence({ pool, pepper, termsVersion }) {
  if (!pool?.query || !pool?.connect) throw new Error('device auth pool is required');
  if (!pepper) throw new Error('device auth pepper is required');
  if (!termsVersion) throw new Error('termsVersion is required');

  const digest = (value) => hashDeviceSecret(value, pepper);

  async function createPairingCode({ adminUserId, label, ttlMs = 10 * 60 * 1000 }) {
    const code = createPairCode();
    const expiresAt = new Date(Date.now() + Math.max(60_000, Number(ttlMs) || 0));
    const result = await pool.query(
      `INSERT INTO bar_kiosk_pair_codes (code_hash, label, created_by_user_id, expires_at)
       VALUES ($1, $2, $3::bigint, $4)
       RETURNING id, label, expires_at, created_at`,
      [digest(code), normalizeDeviceLabel(label), adminUserId, expiresAt]
    );
    return { code, ...result.rows[0] };
  }

  async function pairDevice({ code, label }) {
    const normalized = normalizePairCode(code);
    if (!normalized) throw httpError(400, 'Неверный формат кода привязки.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pairResult = await client.query(
        `SELECT id, label, created_by_user_id, expires_at, consumed_at
         FROM bar_kiosk_pair_codes
         WHERE code_hash = $1
         FOR UPDATE`,
        [digest(normalized)]
      );
      const pair = pairResult.rows[0];
      if (!pair) throw httpError(404, 'Код привязки не найден.');
      if (pair.consumed_at) throw httpError(409, 'Код привязки уже использован.');
      if (new Date(pair.expires_at).getTime() <= Date.now()) throw httpError(410, 'Код привязки истёк.');

      const deviceLabel = normalizeDeviceLabel(label || pair.label);
      const serviceUser = await client.query(
        `INSERT INTO users (
           first_name, role, terms_accepted_at, terms_version, onboarding_completed_at,
           profile_public, show_name, show_avatar, show_leaderboard_amount, show_stats
         ) VALUES ($1, 'staff', NOW(), $2, NOW(), FALSE, FALSE, FALSE, FALSE, FALSE)
         RETURNING id, session_version`,
        [deviceLabel, termsVersion]
      );
      const user = serviceUser.rows[0];
      const token = createDeviceToken();
      const publicId = crypto.randomUUID();
      const deviceResult = await client.query(
        `INSERT INTO bar_kiosk_devices (
           public_id, user_id, label, role, token_hash, created_by_user_id, last_seen_at
         ) VALUES ($1, $2::bigint, $3, 'staff', $4, $5::bigint, NOW())
         RETURNING *`,
        [publicId, user.id, deviceLabel, digest(token), pair.created_by_user_id]
      );
      await client.query(
        `UPDATE bar_kiosk_pair_codes SET consumed_at = NOW() WHERE id = $1::bigint`,
        [pair.id]
      );
      await client.query('COMMIT');
      return {
        token,
        device: safePublicDevice(deviceResult.rows[0]),
        sessionVersion: Number(user.session_version || 1)
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function authenticateDevice(token, { touch = true } = {}) {
    if (!token) return null;
    const result = await pool.query(
      `SELECT d.*, u.session_version, u.deleted_at, u.merged_into_user_id
       FROM bar_kiosk_devices d
       JOIN users u ON u.id = d.user_id
       WHERE d.token_hash = $1
         AND d.revoked_at IS NULL
         AND u.deleted_at IS NULL
         AND u.merged_into_user_id IS NULL
       LIMIT 1`,
      [digest(token)]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    if (touch) {
      await pool.query(
        `UPDATE bar_kiosk_devices SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1::bigint`,
        [row.id]
      );
    }
    return row;
  }

  async function createBootstrap({ deviceToken, ttlMs = 90_000 }) {
    const device = await authenticateDevice(deviceToken);
    if (!device) throw httpError(401, 'Устройство не привязано или отозвано.');
    const code = createBootstrapToken();
    const expiresAt = new Date(Date.now() + Math.max(30_000, Number(ttlMs) || 0));
    await pool.query(
      `INSERT INTO bar_kiosk_bootstrap_codes (device_id, code_hash, expires_at)
       VALUES ($1::bigint, $2, $3)`,
      [device.id, digest(code), expiresAt]
    );
    return { code, expiresAt, device: safePublicDevice(device) };
  }

  async function exchangeBootstrap(code) {
    const raw = String(code || '').trim();
    if (!raw) throw httpError(400, 'Одноразовый код устройства не указан.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT b.id AS bootstrap_id, b.expires_at, b.consumed_at,
                d.*, u.session_version, u.deleted_at, u.merged_into_user_id
         FROM bar_kiosk_bootstrap_codes b
         JOIN bar_kiosk_devices d ON d.id = b.device_id
         JOIN users u ON u.id = d.user_id
         WHERE b.code_hash = $1
         FOR UPDATE OF b`,
        [digest(raw)]
      );
      const row = result.rows[0];
      if (!row) throw httpError(404, 'Код устройства не найден.');
      if (row.consumed_at) throw httpError(409, 'Код устройства уже использован.');
      if (new Date(row.expires_at).getTime() <= Date.now()) throw httpError(410, 'Код устройства истёк.');
      if (row.revoked_at || row.deleted_at || row.merged_into_user_id) throw httpError(401, 'Устройство отозвано.');
      await client.query(`UPDATE bar_kiosk_bootstrap_codes SET consumed_at = NOW() WHERE id = $1::bigint`, [row.bootstrap_id]);
      await client.query(`UPDATE bar_kiosk_devices SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1::bigint`, [row.id]);
      await client.query('COMMIT');
      return {
        userId: String(row.user_id),
        sessionVersion: Number(row.session_version || 1),
        device: safePublicDevice(row)
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function listDevices() {
    const result = await pool.query(
      `SELECT d.*
       FROM bar_kiosk_devices d
       ORDER BY d.revoked_at NULLS FIRST, d.created_at DESC`
    );
    return result.rows.map(safePublicDevice);
  }

  async function revokeDevice({ deviceId, adminUserId }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const deviceResult = await client.query(
        `UPDATE bar_kiosk_devices
         SET revoked_at = COALESCE(revoked_at, NOW()),
             revoked_by_user_id = COALESCE(revoked_by_user_id, $2::bigint),
             updated_at = NOW()
         WHERE id = $1::bigint
         RETURNING *`,
        [deviceId, adminUserId]
      );
      if (!deviceResult.rowCount) throw httpError(404, 'Устройство не найдено.');
      const device = deviceResult.rows[0];
      await client.query(
        `UPDATE users SET session_version = session_version + 1, updated_at = NOW() WHERE id = $1::bigint`,
        [device.user_id]
      );
      await client.query(`DELETE FROM bar_kiosk_bootstrap_codes WHERE device_id = $1::bigint`, [device.id]);
      await client.query('COMMIT');
      return safePublicDevice(device);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    createPairingCode,
    pairDevice,
    authenticateDevice,
    createBootstrap,
    exchangeBootstrap,
    listDevices,
    revokeDevice
  };
}
