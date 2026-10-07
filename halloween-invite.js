import crypto from 'node:crypto';
import { createAdminAdjustmentPersistence } from './admin-adjustment-persistence.js';
import {
  DRAW_ID, dropVoidedFromSnapshot, getHalloweenSummary, grantTickets, lockBalance, ticketsForPurchase, weekKey
} from './halloween-raffle.js';

/**
 * Halloween "Night of Cauldrons": invite a friend + purchase tickets.
 *
 * - Invite code: 8 chars of base32 (A-Z, 2-7) from HMAC-SHA256(server session secret, "halloween-invite:v1:<userId>").
 *   It is stored in halloween_invite_code on first use, so a user always keeps the same code even if the secret
 *   changes later; the stored table is also how a code is resolved back to its owner. On the (very unlikely)
 *   collision with another user's code the next longer prefix (12, then 16 chars) is used.
 * - Attribution: one inviter per invitee forever; the friend can enter a code only during the first 24 hours after
 *   registration, before any completed purchase, while the draw is open; never yourself, never mutually (nor in a
 *   longer circle A -> B -> C -> A), never from an account re-created after a deletion (deleted_identity_tombstones).
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
  let text = String(raw ?? '').trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      if (!['t.me', 'vk.com', 'vk.ru', 'm.vk.com'].includes(url.hostname)) return null;
      text = url.hostname === 't.me' ? (url.searchParams.get('startapp') || '') : url.hash.slice(1);
      if (!/^inv_/i.test(text)) return null;
    } catch { return null; }
  }
  text = text.replace(/^inv_/i, '').toUpperCase();
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

/** The gateway's identityTombstoneSecret (universal-server.js), derived from the environment the same way. */
export function identityTombstoneSecretFromEnv(env = process.env) {
  const configured = String(env.IDENTITY_TOMBSTONE_SECRET || '');
  const fallback = `pivnik-tombstone-development:${String(env.SESSION_SECRET || '') || String(env.TELEGRAM_BOT_TOKEN || '') || 'local'}`;
  return crypto.createHash('sha256').update(configured || fallback).digest();
}

/** Same keyed hash as the gateway's deletedIdentityHash (deleted_identity_tombstones.identity_hash). */
export function deletedIdentityHash(tombstoneSecret, provider, providerUserId) {
  return crypto.createHmac('sha256', tombstoneSecret).update(`deleted-identity:${provider}:${providerUserId}`).digest('hex');
}

/** Same check as the gateway's hasDeletedIdentity: one of the user's identities was deleted before (a returning person). */
async function hasDeletedIdentity(client, userId, tombstoneSecret) {
  const identities = await client.query(
    'SELECT provider, provider_user_id FROM user_identities WHERE user_id = $1::bigint',
    [userId]
  );
  for (const identity of identities.rows) {
    const tombstone = await client.query(
      'SELECT 1 FROM deleted_identity_tombstones WHERE provider = $1 AND identity_hash = $2 LIMIT 1',
      [identity.provider, deletedIdentityHash(tombstoneSecret, identity.provider, identity.provider_user_id)]
    );
    if (tombstone.rows.length) return true;
  }
  return false;
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
  if (!code) return { telegram: null, vk: null };
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
  let entryReason = invitedBy ? 'already_attached' : !user ? 'user_not_found' : !inWindow ? 'window_expired' : null;
  if (!entryReason) {
    const bought = await client.query(`SELECT 1 FROM transactions WHERE client_id = $1 AND ${PURCHASE_SQL} LIMIT 1`, [uid]);
    if (bought.rows.length) entryReason = 'has_purchase';
    else if (!(await drawIsOpen(client, now))) entryReason = 'draw_closed';
  }
  const canEnterCode = !entryReason;
  return { canEnterCode, enterUntil: canEnterCode ? until.toISOString() : null, invitedBy, entryReason };
}

/** GET /api/halloween/summary. Missing setup is explicitly unavailable, never a fabricated zero or invite code. */
export async function getInviteSummary(client, { userId, secret, links = inviteLinkConfigFromEnv(), now = new Date() }) {
  const uid = assertId(userId, 'userId');
  const invite = (code, weekCount, entry = { canEnterCode: false, enterUntil: null, invitedBy: false, entryReason: 'unavailable' }) => ({
    code, weekCount, weekLimit: INVITE_WEEK_LIMIT, bonusPerFriend: INVITE_BONUS, links: inviteLinks(code, links), ...entry
  });
  const unavailable = () => ({
    available: false, tickets: null, status: 'unavailable', closesAt: DEFAULT_CLOSES_AT,
    invite: invite(null, null)
  });
  try {
    const base = await getHalloweenSummary(client, uid);
    if (!base.closesAt) return unavailable();
    const code = await ensureInviteCode(client, { userId: uid, secret });
    const weekCount = await inviteWeekCount(client, uid, weekKey(now));
    const entry = await codeEntryState(client, uid, now);
    const counts = (await client.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'qualified')::int AS qualified,
              COUNT(*) FILTER (WHERE status = 'capped')::int AS capped,
              COUNT(*) FILTER (WHERE status = 'revoked')::int AS revoked
       FROM halloween_invite WHERE inviter_id = $1`, [uid]
    )).rows[0];
    return {
      available: true,
      tickets: base.tickets,
      status: base.status,
      closesAt: base.closesAt || DEFAULT_CLOSES_AT,
      invite: { ...invite(code, weekCount, entry),
        pendingCount: Number(counts.pending), qualifiedCount: Number(counts.qualified),
        cappedCount: Number(counts.capped), revokedCount: Number(counts.revoked)
      }
    };
  } catch (error) {
    if (!isMissingHalloweenSchema(error)) throw error;
    return unavailable();
  }
}

/** Every Halloween write runs after the main operation and is awaited by its route: never wait long on a lock. */
async function inTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL statement_timeout = '3s'");
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
 * Reasons: invalid_code, unknown_code, self_invite, user_not_found, already_attached, mutual_invite (the inviter
 * came, directly or through a chain, by the invitee's code), returning_user (the account was re-created after a
 * deletion; checked when `tombstoneSecret` is given), window_expired (more than 24 hours since the invitee
 * registered), has_purchase (the invitee already bought), draw_closed, unavailable (migration not applied).
 */
export async function claimInvite(client, { inviteeId, code, channel = 'claim', now = new Date(), tombstoneSecret = null }) {
  const uid = assertId(inviteeId, 'inviteeId');
  const normalized = normalizeInviteCode(code);
  if (!normalized) return { attached: false, reason: 'invalid_code' };
  const at = new Date(now).toISOString();
  try {
    return await inTransaction(client, async () => {
      // The draw row first, like the purchase and cancel hooks (lock order: draw, users, balances).
      const drawOpen = await drawIsOpen(client, now, { lock: true });
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
        `WITH RECURSIVE chain(id) AS (
           SELECT inviter_id FROM halloween_invite WHERE invitee_id = $1
           UNION
           SELECT hi.inviter_id FROM halloween_invite hi JOIN chain c ON hi.invitee_id = c.id
         ) SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
        [inviterId, uid]
      );
      if (mutual.rows.length) return { attached: false, reason: 'mutual_invite' };
      if (tombstoneSecret && (await hasDeletedIdentity(client, uid, tombstoneSecret))) {
        return { attached: false, reason: 'returning_user' };
      }
      if (!invitee.rows[0].fresh) return { attached: false, reason: 'window_expired' };
      const bought = await client.query(`SELECT 1 FROM transactions WHERE client_id = $1 AND ${PURCHASE_SQL} LIMIT 1`, [uid]);
      if (bought.rows.length) return { attached: false, reason: 'has_purchase' };
      if (!drawOpen) return { attached: false, reason: 'draw_closed' };
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
 * Lock the ticket balances a purchase hook will touch (buyer, pending inviter) in ascending user id order before
 * anything else, so two purchase hooks whose invites form a circle (A -> B -> C -> A) never wait on each other.
 */
async function lockBalancesInOrder(client, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))].sort((a, b) => a - b);
  for (const id of ids) await lockBalance(client, id);
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
    const pendingInviter = (await client.query(
      `SELECT inviter_id FROM halloween_invite WHERE invitee_id = $1 AND status = 'pending'`, [buyerId]
    )).rows[0]?.inviter_id;
    await lockBalancesInOrder(client, [tickets > 0 ? buyerId : null, pendingInviter ? Number(pendingInviter) : null]);
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
    await lockBalance(client, inviterId); // serialises the weekly count per inviter (already held: lockBalancesInOrder)
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

/** Tickets a grant still stands for: the grant minus what partial returns (`<grantKey-return>:...`) took back. */
async function grantHeld(client, grantKey) {
  const granted = (await client.query(
    'SELECT user_id, delta FROM halloween_ticket_ledger WHERE source_key = $1',
    [grantKey]
  )).rows[0];
  if (!granted || Number(granted.delta) <= 0) return null;
  const returned = grantKey.startsWith('purchase:')
    ? Number((await client.query(
      'SELECT COALESCE(SUM(delta), 0)::int AS n FROM halloween_ticket_ledger WHERE source_key LIKE $1',
      [`purchase-return:${grantKey.slice('purchase:'.length)}:%`]
    )).rows[0].n)
    : 0;
  return { userId: Number(granted.user_id), held: Number(granted.delta) + returned };
}

/** Void the tickets a grant created (those exact tickets first), at most what the user still holds. */
async function revokeGrant(client, { grantKey, revokeKey, reason }) {
  const grant = await grantHeld(client, grantKey);
  if (!grant || grant.held <= 0) return 0;
  const { applied, delta } = await grantTickets(client, {
    userId: grant.userId, delta: -grant.held, reason, sourceKey: revokeKey, revokes: grantKey
  });
  return applied ? -delta : 0;
}

/**
 * After a partial or capped return of a purchase that stays completed (Evotor PAYBACK): the purchase keeps
 * one ticket per full 1 000 ₽ of what was not returned; the rest is taken back. `returnedCents` is the total
 * returned so far for this sale, `returnKey` names this return (idempotent per return). Runs its own transaction.
 */
export async function recordPurchaseReturn(client, { transactionId, returnedCents, returnKey }) {
  const txId = assertId(transactionId, 'transactionId');
  if (!Number.isSafeInteger(returnedCents) || returnedCents < 0) throw new TypeError('returnedCents must be a non-negative integer');
  if (typeof returnKey !== 'string' || !returnKey) throw new TypeError('returnKey is required');
  return inTransaction(client, async () => {
    const drawStatus = (await client.query(
      'SELECT status FROM halloween_draw WHERE id = $1 FOR UPDATE', [DRAW_ID]
    )).rows[0]?.status;
    const tx = (await client.query(
      `SELECT id, check_amount_cents FROM transactions WHERE id = $1 AND ${PURCHASE_SQL}`, [txId]
    )).rows[0];
    if (!tx) return { skipped: 'not_a_purchase' };
    const grant = await grantHeld(client, `purchase:${txId}`);
    if (!grant) return { revoked: 0 };
    const keep = ticketsForPurchase(Math.max(0, Number(tx.check_amount_cents) - returnedCents) / 100);
    if (grant.held <= keep) return { revoked: 0 };
    const sourceKey = `purchase-return:${txId}:${returnKey}`;
    const { applied, delta } = await grantTickets(client, {
      userId: grant.userId, delta: keep - grant.held, reason: 'purchase_revoke', sourceKey, revokes: `purchase:${txId}`
    });
    const revoked = applied ? -delta : 0;
    if (drawStatus === 'closed' && revoked) {
      return { revoked, snapshotRemoved: await dropVoidedFromSnapshot(client, [sourceKey]) };
    }
    return { revoked };
  });
}

/** After a transaction cancel is committed: take back what it granted. Idempotent. Runs its own transaction. */
export async function recordCancellation(client, { transactionId, now = new Date() }) {
  const txId = assertId(transactionId, 'transactionId');
  return inTransaction(client, async () => {
    // Exclusive lock first (purchase hooks and claims take it shared, also first): cancels never deadlock with them,
    // closeDraw cannot freeze the list half-way through, and a closed draw's list can be fixed below.
    const drawStatus = (await client.query(
      'SELECT status FROM halloween_draw WHERE id = $1 FOR UPDATE', [DRAW_ID]
    )).rows[0]?.status;
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
    // Cancelled after close but before the draw: those tickets leave the frozen list too. A drawn result is final.
    if (drawStatus === 'closed' && (purchaseRevoked || inviteRevoked)) {
      const snapshotRemoved = await dropVoidedFromSnapshot(client, [`purchase-cancel:${txId}`, `invite-cancel:${inviteeId}`]);
      return { purchaseRevoked, inviteRevoked, inviteBonusRevoked, snapshotRemoved };
    }
    return { purchaseRevoked, inviteRevoked, inviteBonusRevoked };
  });
}

const missingSchemaReported = new WeakSet(); // per logger, so once per process for console

/**
 * Run a Halloween hook on its own pooled connection, after the main operation committed.
 * Never throws. A missing migration is reported once per process (nothing is recorded until 011 is applied),
 * anything else is logged and swallowed.
 */
export async function runHalloweenHook(pool, label, fn, logger = console) {
  let client;
  try {
    client = await pool.connect();
    return await fn(client);
  } catch (error) {
    if (!isMissingHalloweenSchema(error)) {
      logger.warn?.(`Halloween ${label} skipped:`, error?.code || error?.message || 'unknown');
    } else if (!missingSchemaReported.has(logger)) {
      missingSchemaReported.add(logger);
      logger.error?.('Halloween tables are missing: apply migrations/011_halloween_raffle.sql. Tickets and invites are not recorded until then.');
    }
    return null;
  } finally {
    try { client?.release(); } catch { /* ignore */ }
  }
}
