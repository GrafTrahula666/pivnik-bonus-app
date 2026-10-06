import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  MAX_CANDLES_PER_REQUEST, auditBalances, closeRaffle, createSeededRandomInt, drawNightOfCauldrons,
  drawRaffle, enterRaffle, getHalloweenSummary, grantQuestTicket, grantTickets, pickWinners,
  ticketsForPurchase, weekKey
} from '../halloween-raffle.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';

async function freshDb() {
  const db = new PGlite();
  await db.exec('CREATE TABLE users (id BIGSERIAL PRIMARY KEY, name TEXT)');
  await db.exec(await readFile(new URL('../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
  for (const name of ['a', 'b', 'c', 'd']) await db.query('INSERT INTO users (name) VALUES ($1)', [name]);
  return db;
}
const rejects = (promise, code) => assert.rejects(promise, (e) => e.code === code);

test('migration 011 is manual and repeatable', async () => {
  assert.equal(isAutomaticStartupMigration('011_halloween_raffle.sql'), false);
  const db = await freshDb();
  await db.exec(await readFile(new URL('../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM halloween_raffles')).rows[0].n, 3);
  await db.close();
});

test('purchase tickets: one per full 1000 rub', () => {
  assert.deepEqual([0, 999, 1000, 2500, 3999.9].map(ticketsForPurchase), [0, 0, 1, 2, 3]);
});

test('weekKey follows ISO weeks on the bar clock', () => {
  assert.equal(weekKey(new Date('2026-01-01T12:00:00Z')), '2026-W01');
  assert.equal(weekKey(new Date('2025-12-29T12:00:00Z')), '2026-W01');
  assert.equal(weekKey(new Date('2026-12-31T12:00:00Z')), '2026-W53');
  assert.equal(weekKey(new Date('2026-10-25T22:00:00Z')), '2026-W44'); // Mon 01:00 Moscow
});

test('grants are idempotent per source key and keep balance equal to the ledger', async () => {
  const db = await freshDb();
  const first = await grantTickets(db, { userId: 1, delta: 2, reason: 'purchase', sourceKey: 'purchase:10' });
  const again = await grantTickets(db, { userId: 1, delta: 2, reason: 'purchase', sourceKey: 'purchase:10' });
  assert.deepEqual([first.applied, first.balance, again.applied, again.balance], [true, 2, false, 2]);
  await grantTickets(db, { userId: 1, delta: -2, reason: 'purchase_revoke', sourceKey: 'purchase_revoke:10' });
  assert.equal((await getHalloweenSummary(db, 1)).tickets, 0);
  assert.deepEqual(await auditBalances(db), []);
  await db.query('UPDATE halloween_ticket_balance SET balance = 99 WHERE user_id = 1');
  assert.deepEqual(await auditBalances(db), [{ userId: 1, balance: 99, ledger: 0 }]);
  await db.close();
});

test('quest tickets: once per quest per week, three per week', async () => {
  const db = await freshDb();
  const now = new Date('2026-10-14T10:00:00Z');
  const r = [];
  for (const code of ['q1', 'q1', 'q2', 'q3', 'q4']) r.push((await grantQuestTicket(db, { userId: 2, code, now })).reason);
  assert.deepEqual(r, ['granted', 'already_granted', 'granted', 'granted', 'weekly_limit']);
  const next = await grantQuestTicket(db, { userId: 2, code: 'q4', now: new Date('2026-10-21T10:00:00Z') });
  assert.equal(next.reason, 'granted');
  assert.equal((await getHalloweenSummary(db, 2)).tickets, 4);
  await db.close();
});

test('candle purchase is atomic, replay-safe and cannot overspend', async () => {
  const db = await freshDb();
  await grantTickets(db, { userId: 1, delta: 5, reason: 'admin', sourceKey: 'admin:1' });
  const buy = await enterRaffle(db, { userId: 1, raffleId: 'medium', quantity: 2, requestId: 'req-00000001' });
  assert.deepEqual([buy.candles, buy.spent, buy.balance, buy.replayed], [[1, 2], 4, 1, false]);
  const replay = await enterRaffle(db, { userId: 1, raffleId: 'medium', quantity: 2, requestId: 'req-00000001' });
  assert.deepEqual([replay.candles, replay.balance, replay.replayed], [[1, 2], 1, true]);
  await rejects(enterRaffle(db, { userId: 1, raffleId: 'super', quantity: 1, requestId: 'req-00000002' }), 'insufficient_tickets');
  await rejects(enterRaffle(db, { userId: 1, raffleId: 'nope', quantity: 1, requestId: 'req-00000003' }), 'unknown_raffle');
  await rejects(enterRaffle(db, { userId: 1, raffleId: 'light', quantity: 0, requestId: 'req-00000004' }), 'bad_quantity');
  await rejects(enterRaffle(db, { userId: 1, raffleId: 'light', quantity: MAX_CANDLES_PER_REQUEST + 1, requestId: 'req-00000005' }), 'bad_quantity');
  const s = await getHalloweenSummary(db, 1);
  const medium = s.raffles.find((x) => x.id === 'medium');
  assert.deepEqual([s.tickets, medium.myCandles, medium.totalCandles], [1, 2, 2]);
  assert.doesNotMatch(JSON.stringify(s), /percent|chance|odds/i);
  assert.deepEqual(await auditBalances(db), []);
  await db.close();
});

test('closed or expired cauldron refuses candles', async () => {
  const db = await freshDb();
  await grantTickets(db, { userId: 1, delta: 3, reason: 'admin', sourceKey: 'admin:1' });
  await db.query(`UPDATE halloween_raffles SET closes_at = NOW() - INTERVAL '1 minute' WHERE id = 'light'`);
  await rejects(enterRaffle(db, { userId: 1, raffleId: 'light', quantity: 1, requestId: 'req-00000010' }), 'raffle_closed');
  await db.query(`UPDATE halloween_raffles SET status = 'closed' WHERE id = 'medium'`);
  await rejects(enterRaffle(db, { userId: 1, raffleId: 'medium', quantity: 1, requestId: 'req-00000011' }), 'raffle_closed');
  assert.equal((await getHalloweenSummary(db, 1)).tickets, 3);
  await db.close();
});

test('seeded draw is reproducible and weighted candles belong to distinct winners', () => {
  const a = createSeededRandomInt('ab'.repeat(32));
  const b = createSeededRandomInt('ab'.repeat(32));
  assert.deepEqual([a(0, 1000), a(0, 1000), a(0, 7)], [b(0, 1000), b(0, 1000), b(0, 7)]);
  const entries = [1, 1, 1, 2, 3].map((userId, i) => ({ userId, entryNo: i + 1 }));
  const { winners, reserves } = pickWinners(entries, 2, 5, createSeededRandomInt('01'.repeat(32)));
  const ids = [...winners, ...reserves].map((w) => w.userId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(winners.length, 2);
  assert.equal(ids.length, 3);
});

test('close freezes the candle hash, draw runs once, one prize per person', async () => {
  const db = await freshDb();
  for (const u of [1, 2, 3, 4]) await grantTickets(db, { userId: u, delta: 10, reason: 'admin', sourceKey: `admin:${u}` });
  let n = 0;
  for (const raffleId of ['super', 'medium', 'light']) {
    for (const u of [1, 2, 3, 4]) await enterRaffle(db, { userId: u, raffleId, quantity: 1, requestId: `req-${raffleId}-${u}-${++n}` });
  }
  await db.query(`UPDATE halloween_raffles SET closes_at = NOW() - INTERVAL '1 second'`);
  await rejects(drawRaffle(db, 'super'), 'not_closed');
  for (const id of ['super', 'medium', 'light']) {
    const closed = await closeRaffle(db, id);
    assert.match(closed.entriesHash, /^[0-9a-f]{64}$/);
    assert.equal((await closeRaffle(db, id)).closed, false);
  }
  const seeds = { super: '11'.repeat(32), medium: '22'.repeat(32), light: '33'.repeat(32) };
  const night = await drawNightOfCauldrons(db, { seeds });
  const prizeWinners = ['super', 'medium', 'light'].flatMap((id) => night[id].winners.map((w) => w.userId));
  assert.equal(new Set(prizeWinners).size, prizeWinners.length);
  assert.deepEqual([night.super.winners.length, night.medium.winners.length], [1, 2]);
  await rejects(drawRaffle(db, 'super'), 'not_closed');
  const stored = await db.query(`SELECT seed FROM halloween_raffle_draws WHERE raffle_id = 'super'`);
  assert.equal(stored.rows[0].seed, seeds.super);
  await db.close();
});
