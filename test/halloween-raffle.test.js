import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  auditBalances, closeDraw, createSeededRandomInt, drawNight, getHalloweenSummary, grantQuestTicket,
  grantTickets, pickResults, ticketsForPurchase, weekKey
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
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM halloween_draw')).rows[0].n, 1);
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

test('summary has only counts and time, never odds', async () => {
  const db = await freshDb();
  await grantTickets(db, { userId: 1, delta: 4, reason: 'admin', sourceKey: 'admin:1' });
  const s = await getHalloweenSummary(db, 1);
  assert.deepEqual([s.tickets, s.status], [4, 'open']);
  assert.match(s.closesAt, /^2026-10-31T17:00:00/);
  assert.doesNotMatch(JSON.stringify(s), /percent|chance|odds/i);
  assert.equal((await getHalloweenSummary(db, 3)).tickets, 0);
  await db.close();
});

test('seeded randomness is reproducible', () => {
  const a = createSeededRandomInt('ab'.repeat(32));
  const b = createSeededRandomInt('ab'.repeat(32));
  assert.deepEqual([a(0, 1000), a(0, 1000), a(0, 7)], [b(0, 1000), b(0, 1000), b(0, 7)]);
});

test('every ticket is a chance, one place per person, then participation frames', () => {
  const entries = [{ userId: 1, tickets: 50 }, { userId: 2, tickets: 1 }, { userId: 3, tickets: 1 },
    { userId: 4, tickets: 1 }, { userId: 5, tickets: 1 }, { userId: 6, tickets: 1 }, { userId: 7, tickets: 1 },
    { userId: 8, tickets: 1 }, { userId: 9, tickets: 1 }, { userId: 10, tickets: 0 }];
  const r = pickResults(entries, createSeededRandomInt('01'.repeat(32)));
  const ids = [r.first, r.second, r.third, ...r.participation].map((w) => w.userId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 8);
  assert.ok(!ids.includes(10));
  // user 1 holds 50 of 58 tickets: wins first place for most seeds
  let firsts = 0;
  for (let i = 0; i < 200; i += 1) {
    if (pickResults(entries, createSeededRandomInt(i.toString(16).padStart(64, '0'))).first.userId === 1) firsts += 1;
  }
  assert.ok(firsts > 150);
  assert.deepEqual(pickResults([{ userId: 1, tickets: 2 }], createSeededRandomInt('02'.repeat(32))),
    { first: { userId: 1, tickets: 2 }, participation: [] });
});

test('close freezes tickets and hash, draw runs once and is reproducible', async () => {
  const db = await freshDb();
  const give = { 1: 5, 2: 3, 3: 1, 4: 2 };
  for (const [u, n] of Object.entries(give)) await grantTickets(db, { userId: Number(u), delta: n, reason: 'admin', sourceKey: `admin:${u}` });
  await rejects(drawNight(db), 'not_closed');
  await rejects(closeDraw(db), 'not_due');
  await db.query(`UPDATE halloween_draw SET closes_at = NOW() - INTERVAL '1 second'`);
  const closed = await closeDraw(db);
  assert.match(closed.snapshotHash, /^[0-9a-f]{64}$/);
  assert.deepEqual([closed.participants, closed.tickets], [4, 11]);
  assert.equal((await closeDraw(db)).closed, false);
  await grantTickets(db, { userId: 3, delta: 100, reason: 'admin', sourceKey: 'admin:late' });
  const seed = '77'.repeat(32);
  const night = await drawNight(db, { seed });
  assert.equal(night.results.participation.length, 1);
  const ids = [night.results.first, night.results.second, night.results.third, ...night.results.participation].map((w) => w.userId);
  assert.equal(new Set(ids).size, 4);
  await rejects(drawNight(db), 'not_closed');
  const stored = await db.query('SELECT seed, results FROM halloween_draw');
  assert.equal(stored.rows[0].seed, seed);
  const again = pickResults([{ userId: 1, tickets: 5 }, { userId: 2, tickets: 3 }, { userId: 3, tickets: 1 }, { userId: 4, tickets: 2 }], createSeededRandomInt(seed));
  assert.deepEqual(again, night.results);
  await db.close();
});
