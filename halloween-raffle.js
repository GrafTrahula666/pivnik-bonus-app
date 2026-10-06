import crypto from 'node:crypto';

/**
 * Halloween "Night of Cauldrons": pumpkin tickets and candle purchases.
 * Every function takes `client` with `query(sql, params) => { rows }` (a pg client or PGlite).
 * grantTickets/grantQuestTicket run inside the caller's transaction (wheel spin, purchase);
 * enterRaffle/closeRaffle/drawRaffle open and finish their own transaction.
 * Needs migration 011, which is manual and not part of the startup policy.
 */

export const WEEKLY_QUEST_TICKET_LIMIT = 3;
export const MAX_CANDLES_PER_REQUEST = 50;
export const TICKET_REASONS = Object.freeze(['wheel', 'quest', 'purchase', 'purchase_revoke', 'entry', 'admin']);
const BAR_UTC_OFFSET_HOURS = 3;
const DRAW_ORDER = Object.freeze(['super', 'medium', 'light']);

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
  if (!inserted.rows.length) return { applied: false, ledgerId: null };
  await client.query(
    'UPDATE halloween_ticket_balance SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1',
    [userId, delta]
  );
  return { applied: true, ledgerId: Number(inserted.rows[0].id) };
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

/** Buy `quantity` candles in one cauldron. Replaying the same requestId returns the first result. */
export async function enterRaffle(client, { userId, raffleId, quantity, requestId }) {
  const uid = assertId(userId, 'userId');
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_CANDLES_PER_REQUEST) {
    throw new RaffleError('bad_quantity', `quantity must be 1..${MAX_CANDLES_PER_REQUEST}`);
  }
  if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 80) {
    throw new RaffleError('bad_request_id', 'requestId is required');
  }
  const sourceKey = `entry:${requestId}`;
  return transaction(client, async () => {
    const balance = await lockBalance(client, uid);
    const prior = await client.query(
      `SELECT l.id, l.delta, e.raffle_id, e.entry_no
       FROM halloween_ticket_ledger l
       LEFT JOIN halloween_raffle_entries e ON e.ledger_id = l.id
       WHERE l.source_key = $1 ORDER BY e.entry_no`,
      [sourceKey]
    );
    if (prior.rows.length) {
      return {
        replayed: true,
        raffleId: prior.rows[0].raffle_id,
        candles: prior.rows.map((r) => Number(r.entry_no)),
        spent: -Number(prior.rows[0].delta),
        balance
      };
    }
    const raffle = await client.query(
      `SELECT id, price, status, entries_count, (closes_at > NOW()) AS is_open
       FROM halloween_raffles WHERE id = $1 FOR UPDATE`,
      [raffleId]
    );
    if (!raffle.rows.length) throw new RaffleError('unknown_raffle');
    const r = raffle.rows[0];
    if (r.status !== 'open' || !r.is_open) throw new RaffleError('raffle_closed');
    const cost = Number(r.price) * qty;
    if (balance < cost) throw new RaffleError('insufficient_tickets');
    const { ledgerId } = await applyLedger(client, {
      userId: uid, delta: -cost, reason: 'entry', sourceKey
    });
    const first = Number(r.entries_count) + 1;
    const candles = [];
    for (let i = 0; i < qty; i += 1) {
      candles.push(first + i);
      await client.query(
        `INSERT INTO halloween_raffle_entries (raffle_id, user_id, request_id, ledger_id, entry_no)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.id, uid, requestId, ledgerId, first + i]
      );
    }
    await client.query('UPDATE halloween_raffles SET entries_count = $2 WHERE id = $1', [r.id, first + qty - 1]);
    return { replayed: false, raffleId: r.id, candles, spent: cost, balance: balance - cost };
  });
}

/** Screen data. No odds or percentages on purpose: only counts. */
export async function getHalloweenSummary(client, userId) {
  const uid = assertId(userId, 'userId');
  const bal = await client.query('SELECT balance FROM halloween_ticket_balance WHERE user_id = $1', [uid]);
  const raffles = await client.query(
    `SELECT r.id, r.title, r.price, r.winners_count, r.status, r.closes_at, r.entries_count,
            (SELECT COUNT(*)::int FROM halloween_raffle_entries e WHERE e.raffle_id = r.id AND e.user_id = $1) AS mine
     FROM halloween_raffles r ORDER BY r.price`,
    [uid]
  );
  return {
    tickets: Number(bal.rows[0]?.balance ?? 0),
    raffles: raffles.rows.map((r) => ({
      id: r.id, title: r.title, price: Number(r.price), winners: Number(r.winners_count),
      status: r.status, closesAt: new Date(r.closes_at).toISOString(),
      totalCandles: Number(r.entries_count), myCandles: Number(r.mine)
    }))
  };
}

export function entriesHash(entryIds) {
  return crypto.createHash('sha256').update(entryIds.join(',')).digest('hex');
}

/** Close one cauldron after its time (or at once with force) and freeze the hash of all candles. */
export async function closeRaffle(client, raffleId, { force = false } = {}) {
  return transaction(client, async () => {
    const { rows } = await client.query(
      `SELECT id, status, (closes_at <= NOW()) AS due FROM halloween_raffles WHERE id = $1 FOR UPDATE`,
      [raffleId]
    );
    if (!rows.length) throw new RaffleError('unknown_raffle');
    if (rows[0].status !== 'open') return { closed: false, status: rows[0].status };
    if (!rows[0].due && !force) throw new RaffleError('not_due');
    const entries = await client.query(
      'SELECT id FROM halloween_raffle_entries WHERE raffle_id = $1 ORDER BY entry_no', [raffleId]
    );
    const hash = entriesHash(entries.rows.map((e) => e.id));
    await client.query(
      `UPDATE halloween_raffles SET status = 'closed', entries_hash = $2 WHERE id = $1`, [raffleId, hash]
    );
    return { closed: true, status: 'closed', entriesHash: hash, candles: entries.rows.length };
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

/** Pick `count` winners then `reserves`: a random candle wins, every candle of that user leaves the pool. */
export function pickWinners(entries, count, reserves, randomInt, excludeUserIds = []) {
  let pool = entries.filter((e) => !excludeUserIds.includes(e.userId));
  const take = (n) => {
    const out = [];
    while (out.length < n && pool.length) {
      const hit = pool[randomInt(0, pool.length)];
      out.push({ userId: hit.userId, entryNo: hit.entryNo });
      pool = pool.filter((e) => e.userId !== hit.userId);
    }
    return out;
  };
  const winners = take(count);
  return { winners, reserves: take(reserves) };
}

/** Draw one closed cauldron exactly once and store seed and result. */
export async function drawRaffle(client, raffleId, { seed = crypto.randomBytes(32).toString('hex'), excludeUserIds = [], reserves = 2 } = {}) {
  return transaction(client, async () => {
    const { rows } = await client.query(
      'SELECT id, status, winners_count FROM halloween_raffles WHERE id = $1 FOR UPDATE', [raffleId]
    );
    if (!rows.length) throw new RaffleError('unknown_raffle');
    if (rows[0].status !== 'closed') throw new RaffleError('not_closed');
    const entries = await client.query(
      'SELECT user_id, entry_no FROM halloween_raffle_entries WHERE raffle_id = $1 ORDER BY entry_no', [raffleId]
    );
    const picked = pickWinners(
      entries.rows.map((e) => ({ userId: Number(e.user_id), entryNo: Number(e.entry_no) })),
      Number(rows[0].winners_count), reserves, createSeededRandomInt(seed), excludeUserIds
    );
    await client.query(
      'INSERT INTO halloween_raffle_draws (raffle_id, seed, winners, reserves) VALUES ($1,$2,$3::jsonb,$4::jsonb)',
      [raffleId, seed, JSON.stringify(picked.winners), JSON.stringify(picked.reserves)]
    );
    await client.query(`UPDATE halloween_raffles SET status = 'drawn' WHERE id = $1`, [raffleId]);
    return { raffleId, seed, ...picked };
  });
}

/** Whole night: super first, then medium, then light; one prize per person unless disabled. */
export async function drawNightOfCauldrons(client, { onePrizePerPerson = true, seeds = {} } = {}) {
  const results = {};
  const won = [];
  for (const id of DRAW_ORDER) {
    results[id] = await drawRaffle(client, id, { seed: seeds[id], excludeUserIds: onePrizePerPerson ? won : [] });
    won.push(...results[id].winners.map((w) => w.userId));
  }
  return results;
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
