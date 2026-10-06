import crypto from 'node:crypto';

/**
 * Halloween "Night of Cauldrons": pumpkin tickets and one prize draw.
 * Tickets are never spent. Every ticket has its own serial number (halloween_ticket.number, 1, 2, 3, ... across
 * the whole draw); when the draw closes, every active ticket number is one chance.
 * Places: 1st (Black Cauldron), 2nd (Witch Cauldron), 3rd (Novice Cauldron), plus 5 frames.
 * Fairness does not depend on the show: places are DRAWN 1st -> 2nd -> 3rd (one place per person), then the
 * 5 frames (one frame per person; a place winner may also win a frame). The show REVEALS them in
 * REVEAL_ORDER (frames first, 1st place last), which only changes the order of announcement.
 * Every function takes `client` with `query(sql, params) => { rows }`.
 * grantTickets/grantQuestTicket run inside the caller's transaction (wheel spin, purchase);
 * closeDraw/drawNight open and finish their own transaction. Needs migration 011 (manual, not in the startup policy).
 */

export const DRAW_ID = 'night-of-cauldrons';
export const WEEKLY_QUEST_TICKET_LIMIT = 3;
export const FRAME_WINNERS = 5;
/** Draw order of the places. */
export const PLACES = Object.freeze(['first', 'second', 'third']);
export const FRAME_SLOTS = Object.freeze(Array.from({ length: FRAME_WINNERS }, (_, i) => `frame${i + 1}`));
/** Announcement order for the show: frame1..frame5, then 3rd, 2nd and 1st place last. */
export const REVEAL_ORDER = Object.freeze([...FRAME_SLOTS, 'third', 'second', 'first']);
export const TICKET_REASONS = Object.freeze([
  'wheel', 'quest', 'purchase', 'purchase_revoke', 'invite', 'invite_revoke', 'entry', 'admin'
]);
const BAR_UTC_OFFSET_HOURS = 3;

export class RaffleError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function assertId(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive integer`);
  return n;
}

export function ticketsForPurchase(amountRub) {
  const amount = Math.floor(Number(amountRub));
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount / 1000) : 0;
}

/** ISO week key such as 2026-W44, taken on the bar clock (UTC+3), never the client's. */
export function weekKey(date = new Date()) {
  const d = new Date(new Date(date).getTime() + BAR_UTC_OFFSET_HOURS * 3600_000);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Lock (and create) the user's balance row; returns the current balance. Call inside a transaction. */
export async function lockBalance(client, userId) {
  await client.query(
    'INSERT INTO halloween_ticket_balance (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
    [userId]
  );
  const { rows } = await client.query(
    'SELECT balance FROM halloween_ticket_balance WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  return Number(rows[0].balance);
}

const REVOKED_SOURCE_PREFIXES = Object.freeze([['purchase-cancel:', 'purchase:'], ['invite-cancel:', 'invite:']]);

/** The grant a revocation key takes back: purchase-cancel:<tx> -> purchase:<tx>, invite-cancel:<id> -> invite:<id>. */
export function revokedSourceKey(sourceKey) {
  for (const [revoke, grant] of REVOKED_SOURCE_PREFIXES) {
    if (String(sourceKey).startsWith(revoke)) return grant + String(sourceKey).slice(revoke.length);
  }
  return null;
}

/**
 * Ledger row + numbered tickets + balance, all in the caller's transaction. The user's balance row must already
 * be locked (lockBalance) and `balance` is its value. A revocation never goes below zero: it takes at most what
 * the user holds, and when nothing is left nothing is written (so the key stays free).
 * Positive delta: `delta` new ticket rows, numbers from the global sequence. Negative delta: voids that many of the
 * user's active tickets, the ones created by `revokes` (the original grant) first, then the newest.
 */
async function applyGrant(client, { userId, balance, delta, reason, sourceKey, note = null, revokes = null }) {
  const amount = delta > 0 ? delta : -Math.min(-delta, Math.max(0, balance));
  const none = { applied: false, balance, delta: 0, numbers: [] };
  if (amount === 0) return none;
  const inserted = await client.query(
    `INSERT INTO halloween_ticket_ledger (user_id, delta, reason, source_key, note)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source_key) DO NOTHING RETURNING id`,
    [userId, amount, reason, sourceKey, note]
  );
  if (!inserted.rows.length) return none;
  const tickets = amount > 0
    ? await client.query(
      `INSERT INTO halloween_ticket (user_id, source_key)
       SELECT $1, $2 FROM generate_series(1, $3::int) RETURNING number`,
      [userId, sourceKey, amount]
    )
    : await client.query(
      `UPDATE halloween_ticket SET status = 'void', voided_at = NOW(), void_source_key = $2
       WHERE number IN (
         SELECT number FROM halloween_ticket WHERE user_id = $1 AND status = 'active'
         ORDER BY CASE WHEN source_key = $3::text THEN 0 ELSE 1 END, number DESC
         LIMIT $4::int FOR UPDATE
       ) RETURNING number`,
      [userId, sourceKey, revokes ?? revokedSourceKey(sourceKey), -amount]
    );
  const numbers = tickets.rows.map((r) => Number(r.number)).sort((a, b) => a - b);
  // The balance must equal the active ticket count; refuse (roll back) rather than let them drift apart.
  if (numbers.length !== Math.abs(amount)) throw new RaffleError('ticket_mismatch', 'active tickets do not match the balance');
  const { rows } = await client.query(
    'UPDATE halloween_ticket_balance SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance',
    [userId, amount]
  );
  return { applied: true, balance: Number(rows[0].balance), delta: amount, numbers };
}

/**
 * Idempotent grant or revoke. Call inside the transaction of the event that causes it.
 * Returns { applied, balance, delta (what was actually applied), numbers (ticket numbers created or voided) }.
 * `revokes` names the grant whose tickets a revocation voids first (derived for purchase-cancel:/invite-cancel:).
 */
export async function grantTickets(client, { userId, delta, reason, sourceKey, note, revokes }) {
  const uid = assertId(userId, 'userId');
  if (!Number.isSafeInteger(delta) || delta === 0) throw new TypeError('delta must be a non-zero integer');
  if (!TICKET_REASONS.includes(reason)) throw new TypeError('unknown ticket reason');
  if (typeof sourceKey !== 'string' || !sourceKey) throw new TypeError('sourceKey is required');
  const balance = await lockBalance(client, uid);
  return applyGrant(client, { userId: uid, balance, delta, reason, sourceKey, note, revokes });
}

/** Quest ticket: unique per week and quest code, at most 3 quest tickets per user per week. */
export async function grantQuestTicket(client, { userId, code, now = new Date() }) {
  const uid = assertId(userId, 'userId');
  if (typeof code !== 'string' || !code) throw new TypeError('code is required');
  const week = weekKey(now);
  const balance = await lockBalance(client, uid);
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM halloween_ticket_ledger
     WHERE user_id = $1 AND reason = 'quest' AND source_key LIKE $2`,
    [uid, `quest:${week}:%`]
  );
  const key = `quest:${week}:${code}`;
  const dup = await client.query('SELECT 1 FROM halloween_ticket_ledger WHERE source_key = $1', [key]);
  if (dup.rows.length) return { applied: false, reason: 'already_granted', week };
  if (rows[0].n >= WEEKLY_QUEST_TICKET_LIMIT) return { applied: false, reason: 'weekly_limit', week };
  const { applied } = await applyGrant(client, { userId: uid, balance, delta: 1, reason: 'quest', sourceKey: key });
  return { applied, reason: applied ? 'granted' : 'already_granted', week };
}

async function transaction(client, fn) {
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

/** Screen data: only counts and the time, never odds or percentages. */
export async function getHalloweenSummary(client, userId) {
  const uid = assertId(userId, 'userId');
  const bal = await client.query('SELECT balance FROM halloween_ticket_balance WHERE user_id = $1', [uid]);
  const draw = await client.query('SELECT status, closes_at FROM halloween_draw WHERE id = $1', [DRAW_ID]);
  return {
    tickets: Math.max(0, Number(bal.rows[0]?.balance ?? 0)),
    status: draw.rows[0]?.status ?? 'open',
    closesAt: draw.rows[0] ? new Date(draw.rows[0].closes_at).toISOString() : null
  };
}

/** SHA-256 over the frozen ticket list: "number:userId" sorted by number, joined with commas. */
export function snapshotHash(tickets) {
  const text = [...tickets].sort((a, b) => a.number - b.number).map((t) => `${t.number}:${t.userId}`).join(',');
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function readSnapshot(client) {
  const { rows } = await client.query('SELECT number, user_id FROM halloween_draw_snapshot_ticket ORDER BY number');
  return rows.map((r) => ({ number: Number(r.number), userId: Number(r.user_id) }));
}

/** After closes_at (or with force) freeze every active ticket number with its owner. */
export async function closeDraw(client, { force = false } = {}) {
  return transaction(client, async () => {
    const { rows } = await client.query(
      `SELECT status, (closes_at <= NOW()) AS due FROM halloween_draw WHERE id = $1 FOR UPDATE`, [DRAW_ID]
    );
    if (!rows.length) throw new RaffleError('unknown_draw');
    if (rows[0].status !== 'open') return { closed: false, status: rows[0].status };
    if (!rows[0].due && !force) throw new RaffleError('not_due');
    await client.query('DELETE FROM halloween_draw_snapshot_ticket');
    await client.query(
      `INSERT INTO halloween_draw_snapshot_ticket (number, user_id)
       SELECT number, user_id FROM halloween_ticket WHERE status = 'active'`
    );
    const tickets = await readSnapshot(client);
    const hash = snapshotHash(tickets);
    await client.query(`UPDATE halloween_draw SET status = 'closed', snapshot_hash = $2 WHERE id = $1`, [DRAW_ID, hash]);
    return {
      closed: true, status: 'closed', snapshotHash: hash,
      participants: new Set(tickets.map((t) => t.userId)).size, tickets: tickets.length
    };
  });
}

/** Deterministic randomInt(min, max) from a hex seed (HMAC counter, rejection sampling): the draw can be re-run and checked. */
export function createSeededRandomInt(seedHex) {
  let counter = 0;
  const next32 = () => {
    const mac = crypto.createHmac('sha256', Buffer.from(seedHex, 'hex')).update(String(counter++)).digest();
    return mac.readUInt32BE(0);
  };
  return (min, max) => {
    const range = max - min;
    if (!Number.isInteger(range) || range <= 0) throw new RangeError('empty range');
    const limit = Math.floor(0x100000000 / range) * range;
    let v = next32();
    while (v >= limit) v = next32();
    return min + (v % range);
  };
}

function pickTicket(pool, randomInt) {
  return pool[randomInt(0, pool.length)];
}

/**
 * The draw over the frozen ticket list [{ number, userId }] (input order does not matter: it is sorted by number).
 * 1. Places, drawn in the order 1st -> 2nd -> 3rd: a random ticket among the tickets of people who have not won
 *    a place yet (so every ticket is one chance and nobody wins two places).
 * 2. Frames: a random ticket among the tickets of people who have not won a frame yet (nobody wins two frames;
 *    a place winner can also win a frame).
 * Fewer than 3 people means fewer places; frames are limited to the number of people.
 * Result: { first, second, third: { userId, ticket }, frames: [{ slot: 'frame1', userId, ticket }, ...],
 *           drawOrder: [...slots in the order drawn], revealOrder: [...slots in REVEAL_ORDER that exist] }.
 */
export function pickResults(tickets, randomInt, frameCount = FRAME_WINNERS) {
  const list = tickets
    .map((t) => ({ number: Number(t.number), userId: Number(t.userId) }))
    .sort((a, b) => a.number - b.number);
  if (new Set(list.map((t) => t.number)).size !== list.length) throw new RangeError('duplicate ticket number');
  const results = {};
  const drawOrder = [];
  const placeWinners = new Set();
  for (const place of PLACES) {
    const pool = list.filter((t) => !placeWinners.has(t.userId));
    if (!pool.length) break;
    const hit = pickTicket(pool, randomInt);
    results[place] = { userId: hit.userId, ticket: hit.number };
    placeWinners.add(hit.userId);
    drawOrder.push(place);
  }
  const frames = [];
  const frameWinners = new Set();
  for (let i = 0; i < Math.min(frameCount, FRAME_SLOTS.length); i += 1) {
    const pool = list.filter((t) => !frameWinners.has(t.userId));
    if (!pool.length) break;
    const hit = pickTicket(pool, randomInt);
    frames.push({ slot: FRAME_SLOTS[i], userId: hit.userId, ticket: hit.number });
    frameWinners.add(hit.userId);
    drawOrder.push(FRAME_SLOTS[i]);
  }
  results.frames = frames;
  results.drawOrder = drawOrder;
  results.revealOrder = REVEAL_ORDER.filter((slot) => drawOrder.includes(slot));
  return results;
}

/** Run the draw once on the frozen snapshot and store seed and result. */
export async function drawNight(client, { seed = crypto.randomBytes(32).toString('hex') } = {}) {
  return transaction(client, async () => {
    const { rows } = await client.query(
      'SELECT status, snapshot_hash FROM halloween_draw WHERE id = $1 FOR UPDATE', [DRAW_ID]
    );
    if (!rows.length) throw new RaffleError('unknown_draw');
    if (rows[0].status !== 'closed') throw new RaffleError('not_closed');
    const tickets = await readSnapshot(client);
    const hash = snapshotHash(tickets);
    if (hash !== rows[0].snapshot_hash) throw new RaffleError('snapshot_mismatch');
    const results = pickResults(tickets, createSeededRandomInt(seed));
    await client.query(
      `UPDATE halloween_draw SET status = 'drawn', seed = $2, results = $3::jsonb, drawn_at = NOW() WHERE id = $1`,
      [DRAW_ID, seed, JSON.stringify(results)]
    );
    return { seed, snapshotHash: hash, results };
  });
}

/**
 * The cached balance must equal the ledger sum and the number of active tickets.
 * Returns the mismatching users (empty array means healthy).
 */
export async function auditBalances(client) {
  const { rows } = await client.query(
    `WITH l AS (SELECT user_id, SUM(delta)::int AS ledger FROM halloween_ticket_ledger GROUP BY user_id),
          t AS (SELECT user_id, COUNT(*)::int AS active FROM halloween_ticket WHERE status = 'active' GROUP BY user_id),
          u AS (SELECT user_id FROM halloween_ticket_balance UNION SELECT user_id FROM l UNION SELECT user_id FROM t)
     SELECT u.user_id, COALESCE(b.balance, 0) AS balance, COALESCE(l.ledger, 0) AS ledger, COALESCE(t.active, 0) AS active
     FROM u
     LEFT JOIN halloween_ticket_balance b ON b.user_id = u.user_id
     LEFT JOIN l ON l.user_id = u.user_id
     LEFT JOIN t ON t.user_id = u.user_id
     WHERE COALESCE(b.balance, 0) <> COALESCE(l.ledger, 0) OR COALESCE(b.balance, 0) <> COALESCE(t.active, 0)
     ORDER BY u.user_id`
  );
  return rows.map((r) => ({
    userId: Number(r.user_id), balance: Number(r.balance), ledger: Number(r.ledger), active: Number(r.active)
  }));
}
