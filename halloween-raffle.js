import crypto from 'node:crypto';

/**
 * Halloween "Night of Cauldrons": pumpkin tickets and one prize draw.
 * Tickets are never spent. Everyone keeps all tickets; when the draw closes, each ticket is one chance.
 * Places: 1st (Black Cauldron), 2nd (Witch Cauldron), 3rd (Novice Cauldron), then 5 participation frames.
 * One person can win only one place. Every function takes `client` with `query(sql, params) => { rows }`.
 * grantTickets/grantQuestTicket run inside the caller's transaction (wheel spin, purchase);
 * closeDraw/drawNight open and finish their own transaction. Needs migration 011 (manual, not in the startup policy).
 */

export const DRAW_ID = 'night-of-cauldrons';
export const WEEKLY_QUEST_TICKET_LIMIT = 3;
export const PARTICIPATION_WINNERS = 5;
export const PLACES = Object.freeze(['first', 'second', 'third']);
export const TICKET_REASONS = Object.freeze(['wheel', 'quest', 'purchase', 'purchase_revoke', 'entry', 'admin']);
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

async function lockBalance(client, userId) {
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

async function applyLedger(client, { userId, delta, reason, sourceKey, note = null }) {
  const inserted = await client.query(
    `INSERT INTO halloween_ticket_ledger (user_id, delta, reason, source_key, note)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source_key) DO NOTHING RETURNING id`,
    [userId, delta, reason, sourceKey, note]
  );
  if (!inserted.rows.length) return { applied: false };
  await client.query(
    'UPDATE halloween_ticket_balance SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1',
    [userId, delta]
  );
  return { applied: true };
}

/** Idempotent grant or revoke. Call inside the transaction of the event that causes it. */
export async function grantTickets(client, { userId, delta, reason, sourceKey, note }) {
  const uid = assertId(userId, 'userId');
  if (!Number.isSafeInteger(delta) || delta === 0) throw new TypeError('delta must be a non-zero integer');
  if (!TICKET_REASONS.includes(reason)) throw new TypeError('unknown ticket reason');
  if (typeof sourceKey !== 'string' || !sourceKey) throw new TypeError('sourceKey is required');
  await lockBalance(client, uid);
  const { applied } = await applyLedger(client, { userId: uid, delta, reason, sourceKey, note });
  const { rows } = await client.query('SELECT balance FROM halloween_ticket_balance WHERE user_id = $1', [uid]);
  return { applied, balance: Number(rows[0].balance) };
}

/** Quest ticket: unique per week and quest code, at most 3 quest tickets per user per week. */
export async function grantQuestTicket(client, { userId, code, now = new Date() }) {
  const uid = assertId(userId, 'userId');
  if (typeof code !== 'string' || !code) throw new TypeError('code is required');
  const week = weekKey(now);
  await lockBalance(client, uid);
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM halloween_ticket_ledger
     WHERE user_id = $1 AND reason = 'quest' AND source_key LIKE $2`,
    [uid, `quest:${week}:%`]
  );
  const key = `quest:${week}:${code}`;
  const dup = await client.query('SELECT 1 FROM halloween_ticket_ledger WHERE source_key = $1', [key]);
  if (dup.rows.length) return { applied: false, reason: 'already_granted', week };
  if (rows[0].n >= WEEKLY_QUEST_TICKET_LIMIT) return { applied: false, reason: 'weekly_limit', week };
  const { applied } = await applyLedger(client, { userId: uid, delta: 1, reason: 'quest', sourceKey: key });
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

export function snapshotHash(rows) {
  const text = [...rows].sort((a, b) => a.userId - b.userId).map((r) => `${r.userId}:${r.tickets}`).join(',');
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** After closes_at (or with force) freeze everyone's tickets. Negative or zero balances do not take part. */
export async function closeDraw(client, { force = false } = {}) {
  return transaction(client, async () => {
    const { rows } = await client.query(
      `SELECT status, (closes_at <= NOW()) AS due FROM halloween_draw WHERE id = $1 FOR UPDATE`, [DRAW_ID]
    );
    if (!rows.length) throw new RaffleError('unknown_draw');
    if (rows[0].status !== 'open') return { closed: false, status: rows[0].status };
    if (!rows[0].due && !force) throw new RaffleError('not_due');
    await client.query(
      `INSERT INTO halloween_draw_snapshot (user_id, tickets)
       SELECT user_id, balance FROM halloween_ticket_balance WHERE balance > 0`
    );
    const snap = await client.query('SELECT user_id, tickets FROM halloween_draw_snapshot');
    const entries = snap.rows.map((r) => ({ userId: Number(r.user_id), tickets: Number(r.tickets) }));
    const hash = snapshotHash(entries);
    await client.query(`UPDATE halloween_draw SET status = 'closed', snapshot_hash = $2 WHERE id = $1`, [DRAW_ID, hash]);
    return {
      closed: true, status: 'closed', snapshotHash: hash,
      participants: entries.length, tickets: entries.reduce((s, e) => s + e.tickets, 0)
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

/**
 * 1st, 2nd, 3rd place weighted by tickets (each ticket is one chance, the winner leaves the pool),
 * then `participation` more people chosen with equal chance from everyone who is left.
 */
export function pickResults(entries, randomInt, participation = PARTICIPATION_WINNERS) {
  let pool = entries.filter((e) => e.tickets > 0);
  const results = {};
  for (const place of PLACES) {
    const total = pool.reduce((s, e) => s + e.tickets, 0);
    if (!total) break;
    let ticket = randomInt(0, total);
    const hit = pool.find((e) => (ticket -= e.tickets) < 0);
    results[place] = { userId: hit.userId, tickets: hit.tickets };
    pool = pool.filter((e) => e.userId !== hit.userId);
  }
  results.participation = [];
  while (results.participation.length < participation && pool.length) {
    const hit = pool[randomInt(0, pool.length)];
    results.participation.push({ userId: hit.userId, tickets: hit.tickets });
    pool = pool.filter((e) => e.userId !== hit.userId);
  }
  return results;
}

/** Run the draw once on the frozen snapshot and store seed and result. */
export async function drawNight(client, { seed = crypto.randomBytes(32).toString('hex') } = {}) {
  return transaction(client, async () => {
    const { rows } = await client.query('SELECT status FROM halloween_draw WHERE id = $1 FOR UPDATE', [DRAW_ID]);
    if (!rows.length) throw new RaffleError('unknown_draw');
    if (rows[0].status !== 'closed') throw new RaffleError('not_closed');
    const snap = await client.query('SELECT user_id, tickets FROM halloween_draw_snapshot ORDER BY user_id');
    const results = pickResults(
      snap.rows.map((r) => ({ userId: Number(r.user_id), tickets: Number(r.tickets) })),
      createSeededRandomInt(seed)
    );
    await client.query(
      `UPDATE halloween_draw SET status = 'drawn', seed = $2, results = $3::jsonb, drawn_at = NOW() WHERE id = $1`,
      [DRAW_ID, seed, JSON.stringify(results)]
    );
    return { seed, results };
  });
}

/** Cached balance must equal the ledger sum. Returns the mismatching users (empty array means healthy). */
export async function auditBalances(client) {
  const { rows } = await client.query(
    `SELECT b.user_id, b.balance, COALESCE(SUM(l.delta), 0)::int AS ledger
     FROM halloween_ticket_balance b
     LEFT JOIN halloween_ticket_ledger l ON l.user_id = b.user_id
     GROUP BY b.user_id, b.balance HAVING b.balance <> COALESCE(SUM(l.delta), 0)`
  );
  return rows.map((r) => ({ userId: Number(r.user_id), balance: Number(r.balance), ledger: Number(r.ledger) }));
}
