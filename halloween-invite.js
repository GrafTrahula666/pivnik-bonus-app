import crypto from 'node:crypto';
import { createAdminAdjustmentPersistence } from './admin-adjustment-persistence.js';
import { DRAW_ID, getHalloweenSummary, grantTickets, lockBalance, ticketsForPurchase, weekKey } from './halloween-raffle.js';

/**
 * Halloween "Night of Cauldrons": invite a friend + purchase tickets.
 *
 * - Invite code: 8 chars of base32 (A-Z, 2-7) from HMAC-SHA256(server session secret, "halloween-invite:v1:<userId>").
 *   It is stored in halloween_invite_code on first use, so a user always keeps the same code even if the secret
 *   changes later; the stored table is also how a code is resolved back to its owner. On the (very unlikely)
 *   collision with another user's code the next longer prefix (12, then 16 chars) is used.
 * - Attribution: one inviter per invitee forever; the friend can enter a code only during the first 24 hours after
 *   registration, before any completed purchase, while the draw is open; never yourself, never mutually.
 * - The inviter gets 1 ticket (reason 'invite', source key invite:<inviteeId>) and INVITE_BONUS bonuses (an
 *   'adjustment' transaction «Бонус за друга», request_key halloween-invite-bonus:<inviteeId>, once per friend
 *   ever) on the invitee's first completed staff purchase, at most 3 per ISO week (bar clock, week of that
 *   purchase), only while the draw is open.
 * - The buyer gets 1 ticket per full 1 000 rub of the check (reason 'purchase', source key purchase:<txId>) while
 *   the draw is open. Cancelling the transaction revokes exactly that (purchase-cancel:<txId>) and, if it was the
 *   invitee's qualifying first purchase, the inviter's ticket (invite-cancel:<inviteeId>) and bonuses
 *   (halloween-invite-bonus-cancel:<inviteeId>). Ticket and bonus balances never go below 0.
 *
 * Everything here needs migration 011 (manual). Without its tables the summary answers with a fallback and the
 * hooks are skipped (error code 42P01 / 42703 are treated as "not installed").
 */

export const INVITE_WEEK_LIMIT = 3;
export const INVITE_NEW_ACCOUNT_HOURS = 24;
export const INVITE_BONUS = 100;
export const INVITE_BONUS_REASON = 'Бонус за друга';
export const INVITE_BONUS_REVOKE_REASON = 'Отмена бонуса за друга';
export const DEFAULT_CLOSES_AT = '2026-10-31T20:00:00+03:00';
export const PURCHASE_MODES = Object.freeze(['accrue', 'redeem']);
const CODE_LENGTHS = [8, 12, 16];
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703']);

export function isMissingHalloweenSchema(error) {
  return MISSING_SCHEMA_CODES.has(String(error?.code || ''));
}

function assertId(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive integer`);
  return n;
}

function base32(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function deriveInviteCode(secret, userId, length = 8) {
  const uid = assertId(userId, 'userId');
  if (!secret || !secret.length) throw new TypeError('secret is required');
  const mac = crypto.createHmac('sha256', secret).update(`halloween-invite:v1:${uid}`).digest();
  return base32(mac).slice(0, length);
}

/** Accepts "inv_ABCD2345", "abcd2345" etc. Returns the canonical upper-case code or null. */
export function normalizeInviteCode(raw) {
  const text = String(raw ?? '').trim().replace(/^inv_/i, '').toUpperCase();
  return /^[A-Z2-7]{8,16}$/.test(text) ? text : null;
}

/** start_param from Telegram initData. Only call after the initData signature was validated. */
export function inviteCodeFromStartParam(initData) {
  try {
    const startParam = new URLSearchParams(String(initData || '')).get('start_param') || '';
    return /^inv_/i.test(startParam) ? normalizeInviteCode(startParam) : null;
  } catch {
    return null;
  }
}

export function inviteLinkConfigFromEnv(env = process.env) {
  return {
    telegramBotUsername: String(env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, ''),
    telegramMiniAppShortName: String(env.TELEGRAM_MINI_APP_SHORT_NAME || '').trim(),
    vkAppId: String(env.VK_APP_ID || '').trim()
  };
}

/** Links are null when the value they need is not configured; nothing is guessed. */
export function inviteLinks(code, config = {}) {
  const bot = String(config.telegramBotUsername || '');
  const shortName = String(config.telegramMiniAppShortName || '');
  const vkAppId = String(config.vkAppId || '');
  const telegram = /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(bot) && /^[A-Za-z0-9_]{3,64}$/.test(shortName)
    ? `https://t.me/${bot}/${shortName}?startapp=inv_${code}`
    : null;
  const vk = /^\d{1,12}$/.test(vkAppId) ? `https://vk.com/app${vkAppId}#inv_${code}` : null;
  return { telegram, vk };
}

/** Returns the user's stored code, storing the derived one on first use. */
export async function ensureInviteCode(client, { userId, secret }) {
  const uid = assertId(userId, 'userId');
  const read = async () => (await client.query('SELECT code FROM halloween_invite_code WHERE user_id = $1', [uid])).rows[0]?.code;
  const stored = await read();
  if (stored) return stored;
  for (const length of CODE_LENGTHS) {
    const code = deriveInviteCode(secret, uid, length);
    const inserted = await client.query(
      'INSERT INTO halloween_invite_code (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code',
      [uid, code]
    );
    if (inserted.rows.length) return inserted.rows[0].code;
    const raced = await read();
    if (raced) return raced;
  }
  throw new Error('invite code collision');
}

async function inviteWeekCount(client, inviterId, week) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM halloween_invite
     WHERE inviter_id = $1 AND status = 'qualified' AND week_key = $2`,
    [inviterId, week]
  );
  return Number(rows[0]?.n || 0);
}

const PURCHASE_SQL = `status = 'completed' AND mode IN ('accrue', 'redeem') AND check_amount_cents > 0`;

/** `lock` takes a share lock on the draw row so closeDraw waits for this transaction (use inside a transaction). */
async function drawIsOpen(client, now, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT (status = 'open' AND closes_at > $2::timestamptz) AS open FROM halloween_draw WHERE id = $1${lock ? ' FOR SHARE' : ''}`,
    [DRAW_ID, new Date(now).toISOString()]
  );
  return Boolean(rows[0]?.open);
}

/** Whether this user may still enter a friend's code, and until when (only while that is possible). */
async function codeEntryState(client, uid, now) {
  const user = (await client.query(
    `SELECT created_at + make_interval(hours => $2) AS until
     FROM users WHERE id = $1 AND deleted_at IS NULL AND merged_into_user_id IS NULL`,
    [uid, INVITE_NEW_ACCOUNT_HOURS]
  )).rows[0];
  const invitedBy = (await client.query('SELECT 1 FROM halloween_invite WHERE invitee_id = $1', [uid])).rows.length > 0;
  const until = user?.until ? new Date(user.until) : null;
  const inWindow = Boolean(until && until.getTime() > new Date(now).getTime());
  let canEnterCode = inWindow && !invitedBy;
  if (canEnterCode) {
    const bought = await client.query(`SELECT 1 FROM transactions WHERE client_id = $1 AND ${PURCHASE_SQL} LIMIT 1`, [uid]);
    canEnterCode = !bought.rows.length && (await drawIsOpen(client, now));
  }
  return { canEnterCode, enterUntil: canEnterCode ? until.toISOString() : null, invitedBy };
}

/** GET /api/halloween/summary payload. Never throws for a missing migration. Only counts and time, never odds. */
export async function getInviteSummary(client, { userId, secret, links = inviteLinkConfigFromEnv(), now = new Date() }) {
  const uid = assertId(userId, 'userId');
  const invite = (code, weekCount, entry = { canEnterCode: false, enterUntil: null, invitedBy: false }) => ({
    code, weekCount, weekLimit: INVITE_WEEK_LIMIT, bonusPerFriend: INVITE_BONUS, links: inviteLinks(code, links), ...entry
  });
  try {
    const base = await getHalloweenSummary(client, uid);
    const code = await ensureInviteCode(client, { userId: uid, secret });
    const weekCount = await inviteWeekCount(client, uid, weekKey(now));
    const entry = await codeEntryState(client, uid, now);
    return {
      tickets: base.tickets,
      status: base.status,
      closesAt: base.closesAt || DEFAULT_CLOSES_AT,
      invite: invite(code, weekCount, entry)
    };
  } catch (error) {
    if (!isMissingHalloweenSchema(error)) throw error;
    return { tickets: 0, status: 'open', closesAt: DEFAULT_CLOSES_AT, invite: invite(deriveInviteCode(secret, uid), 0) };
  }
}

async function inTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection already aborted */ }
    throw error;
  }
}

/**
 * Attach the invitee to the code's owner. `client` must be one connection (it runs its own transaction).
 * Never throws for a bad code: returns { attached: false, reason }.
 * Codes are matched case-insensitively, with or without the inv_ prefix.
 * Reasons: invalid_code, unknown_code, self_invite, user_not_found, already_attached, mutual_invite,
 * window_expired (more than 24 hours since the invitee registered), has_purchase (the invitee already bought),
 * draw_closed, unavailable (migration not applied).
 */
export async function claimInvite(client, { inviteeId, code, channel = 'claim', now = new Date() }) {
  const uid = assertId(inviteeId, 'inviteeId');
  const normalized = normalizeInviteCode(code);
  if (!normalized) return { attached: false, reason: 'invalid_code' };
  const at = new Date(now).toISOString();
  try {
    return await inTransaction(client, async () => {
      const owner = await client.query(
        `SELECT ic.user_id FROM halloween_invite_code ic
         JOIN users u ON u.id = ic.user_id
         WHERE ic.code = $1 AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL`,
        [normalized]
      );
      if (!owner.rows.length) return { attached: false, reason: 'unknown_code' };
      const inviterId = Number(owner.rows[0].user_id);
      if (inviterId === uid) return { attached: false, reason: 'self_invite' };
      const invitee = await client.query(
        `SELECT (created_at > $2::timestamptz - make_interval(hours => $3)) AS fresh
         FROM users WHERE id = $1 AND deleted_at IS NULL AND merged_into_user_id IS NULL FOR UPDATE`,
        [uid, at, INVITE_NEW_ACCOUNT_HOURS]
      );
      if (!invitee.rows.length) return { attached: false, reason: 'user_not_found' };
      const existing = await client.query('SELECT inviter_id FROM halloween_invite WHERE invitee_id = $1', [uid]);
      if (existing.rows.length) return { attached: false, reason: 'already_attached' };
      const mutual = await client.query(
        'SELECT 1 FROM halloween_invite WHERE invitee_id = $1 AND inviter_id = $2',
        [inviterId, uid]
      );
      if (mutual.rows.length) return { attached: false, reason: 'mutual_invite' };
      if (!invitee.rows[0].fresh) return { attached: false, reason: 'window_expired' };
      const bought = await client.query(`SELECT 1 FROM transactions WHERE client_id = $1 AND ${PURCHASE_SQL} LIMIT 1`, [uid]);
      if (bought.rows.length) return { attached: false, reason: 'has_purchase' };
      if (!(await drawIsOpen(client, now, { lock: true }))) return { attached: false, reason: 'draw_closed' };
      const inserted = await client.query(
        `INSERT INTO halloween_invite (invitee_id, inviter_id, code, channel, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz) ON CONFLICT (invitee_id) DO NOTHING RETURNING invitee_id`,
        [uid, inviterId, normalized, channel === 'telegram_start_param' ? 'telegram_start_param' : 'claim', at]
      );
      return inserted.rows.length ? { attached: true } : { attached: false, reason: 'already_attached' };
    });
  } catch (error) {
    if (isMissingHalloweenSchema(error)) return { attached: false, reason: 'unavailable' };
    throw error;
  }
}

const inviteBonusKey = (inviteeId) => `halloween-invite-bonus:${inviteeId}`;
const inviteBonusCancelKey = (inviteeId) => `halloween-invite-bonus-cancel:${inviteeId}`;

/**
 * Credit (amount > 0) or take back (amount < 0, never below a zero wallet) bonuses through the same wallet +
 * 'adjustment' transaction path as an owner adjustment, so balance, history and the client's list agree.
 * Idempotent by request_key. Returns the amount moved (0 when already done or nothing left to take).
 */
async function moveInviteBonus(client, { userId, amount, requestKey, reason }) {
  if ((await client.query('SELECT 1 FROM transactions WHERE request_key = $1', [requestKey])).rows.length) return 0;
  await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const wallet = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
  const balance = Number(wallet.rows[0].balance || 0);
  const delta = amount > 0 ? amount : -Math.min(-amount, Math.max(0, balance));
  if (delta === 0) return 0;
  await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [balance + delta, userId]);
  await createAdminAdjustmentPersistence({ query: client.query.bind(client) })({
    transaction: {
      request_key: requestKey,
      client_id: userId,
      staff_id: null,
      mode: 'adjustment',
      status: 'completed',
      bonus_spent: delta < 0 ? -delta : 0,
      bonus_earned: delta > 0 ? delta : 0,
      balance_after: balance + delta,
      reason
    }
  });
  return Math.abs(delta);
}

/**
 * After a staff purchase is committed: purchase tickets for the buyer and, on the invitee's first purchase,
 * the inviter's ticket and INVITE_BONUS bonuses (same transaction, so both or neither). Idempotent (safe to run again for the same transaction). Runs its own transaction.
 */
export async function recordPurchase(client, { transactionId, now = new Date() }) {
  const txId = assertId(transactionId, 'transactionId');
  return inTransaction(client, async () => {
    const txResult = await client.query(
      `SELECT id, client_id, check_amount_cents FROM transactions WHERE id = $1 AND ${PURCHASE_SQL}`,
      [txId]
    );
    const tx = txResult.rows[0];
    if (!tx) return { skipped: 'not_a_purchase' };
    if (!(await drawIsOpen(client, now, { lock: true }))) return { skipped: 'draw_closed' };
    const buyerId = Number(tx.client_id);
    const result = { purchaseTickets: 0, invite: null };

    const tickets = ticketsForPurchase(Number(tx.check_amount_cents) / 100);
    if (tickets > 0) {
      const grant = await grantTickets(client, {
        userId: buyerId, delta: tickets, reason: 'purchase', sourceKey: `purchase:${txId}`
      });
      result.purchaseTickets = grant.applied ? tickets : 0;
    }

    const inviteRow = await client.query(
      `SELECT inviter_id, status FROM halloween_invite WHERE invitee_id = $1 FOR UPDATE`,
      [buyerId]
    );
    const invite = inviteRow.rows[0];
    if (!invite || invite.status !== 'pending') return result;
    // The qualifying purchase is the invitee's first completed one (heals a missed hook on that purchase).
    const first = (await client.query(
      `SELECT id, created_at FROM transactions WHERE client_id = $1 AND ${PURCHASE_SQL} ORDER BY id ASC LIMIT 1`,
      [buyerId]
    )).rows[0];
    const inviterId = Number(invite.inviter_id);
    const week = weekKey(new Date(first.created_at));
    await lockBalance(client, inviterId); // serialises the weekly count per inviter
    if ((await inviteWeekCount(client, inviterId, week)) >= INVITE_WEEK_LIMIT) {
      await client.query(
        `UPDATE halloween_invite SET status = 'capped', qualifying_tx_id = $2, week_key = $3, qualified_at = $4::timestamptz
         WHERE invitee_id = $1`,
        [buyerId, first.id, week, new Date(now).toISOString()]
      );
      result.invite = { granted: false, reason: 'weekly_limit', inviterId, week };
      return result;
    }
    const grant = await grantTickets(client, {
      userId: inviterId, delta: 1, reason: 'invite', sourceKey: `invite:${buyerId}`, note: `tx:${first.id}`
    });
    await client.query(
      `UPDATE halloween_invite SET status = 'qualified', qualifying_tx_id = $2, week_key = $3, qualified_at = $4::timestamptz
       WHERE invitee_id = $1`,
      [buyerId, first.id, week, new Date(now).toISOString()]
    );
    const bonus = await moveInviteBonus(client, {
      userId: inviterId, amount: INVITE_BONUS, requestKey: inviteBonusKey(buyerId), reason: INVITE_BONUS_REASON
    });
    result.invite = { granted: grant.applied, reason: grant.applied ? 'granted' : 'already_granted', inviterId, week, bonus };
    return result;
  });
}

/** Void the tickets a grant created (those exact tickets first), at most what the user still holds. */
async function revokeGrant(client, { grantKey, revokeKey, reason }) {
  const granted = (await client.query(
    'SELECT user_id, delta FROM halloween_ticket_ledger WHERE source_key = $1',
    [grantKey]
  )).rows[0];
  if (!granted || Number(granted.delta) <= 0) return 0;
  const { applied, delta } = await grantTickets(client, {
    userId: Number(granted.user_id), delta: -Number(granted.delta), reason, sourceKey: revokeKey, revokes: grantKey
  });
  return applied ? -delta : 0;
}

/** After a transaction cancel is committed: take back what it granted. Idempotent. Runs its own transaction. */
export async function recordCancellation(client, { transactionId, now = new Date() }) {
  const txId = assertId(transactionId, 'transactionId');
  return inTransaction(client, async () => {
    const tx = (await client.query(
      `SELECT id, client_id FROM transactions WHERE id = $1 AND status = 'cancelled'`,
      [txId]
    )).rows[0];
    if (!tx) return { skipped: 'not_cancelled' };
    const inviteeId = Number(tx.client_id);
    const purchaseRevoked = await revokeGrant(client, {
      grantKey: `purchase:${txId}`, revokeKey: `purchase-cancel:${txId}`, reason: 'purchase_revoke'
    });
    let inviteRevoked = 0;
    let inviteBonusRevoked = 0;
    const invite = (await client.query(
      `SELECT status FROM halloween_invite WHERE invitee_id = $1 AND qualifying_tx_id = $2 FOR UPDATE`,
      [inviteeId, txId]
    )).rows[0];
    if (invite?.status === 'qualified') {
      inviteRevoked = await revokeGrant(client, {
        grantKey: `invite:${inviteeId}`, revokeKey: `invite-cancel:${inviteeId}`, reason: 'invite_revoke'
      });
      const credit = (await client.query(
        'SELECT client_id, bonus_earned FROM transactions WHERE request_key = $1',
        [inviteBonusKey(inviteeId)]
      )).rows[0];
      if (credit && Number(credit.bonus_earned) > 0) {
        inviteBonusRevoked = await moveInviteBonus(client, {
          userId: Number(credit.client_id), amount: -Number(credit.bonus_earned),
          requestKey: inviteBonusCancelKey(inviteeId), reason: INVITE_BONUS_REVOKE_REASON
        });
      }
      await client.query(
        `UPDATE halloween_invite SET status = 'revoked', revoked_at = $2::timestamptz WHERE invitee_id = $1`,
        [inviteeId, new Date(now).toISOString()]
      );
    }
    return { purchaseRevoked, inviteRevoked, inviteBonusRevoked };
  });
}

/**
 * Run a Halloween hook on its own pooled connection, after the main operation committed.
 * Never throws: a missing migration is skipped silently, anything else is logged and swallowed.
 */
export async function runHalloweenHook(pool, label, fn, logger = console) {
  let client;
  try {
    client = await pool.connect();
    return await fn(client);
  } catch (error) {
    if (!isMissingHalloweenSchema(error)) {
      logger.warn?.(`Halloween ${label} skipped:`, error?.code || error?.message || 'unknown');
    }
    return null;
  } finally {
    try { client?.release(); } catch { /* ignore */ }
  }
}
