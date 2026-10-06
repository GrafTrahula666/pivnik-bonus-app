import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  auditBalances, closeDraw, createSeededRandomInt, drawNight, getHalloweenSummary, grantQuestTicket,
  grantTickets, pickResults, snapshotHash, ticketsForPurchase, weekKey
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

const activeNumbers = async (db, userId) => (await db.query(
  `SELECT number FROM halloween_ticket WHERE user_id = $1 AND status = 'active' ORDER BY number`, [userId]
)).rows.map((r) => Number(r.number));

test('grants are idempotent per source key and keep balance equal to the ledger and the active tickets', async () => {
  const db = await freshDb();
  const first = await grantTickets(db, { userId: 1, delta: 2, reason: 'purchase', sourceKey: 'purchase:10' });
  const again = await grantTickets(db, { userId: 1, delta: 2, reason: 'purchase', sourceKey: 'purchase:10' });
  assert.deepEqual([first.applied, first.balance, again.applied, again.balance], [true, 2, false, 2]);
  assert.deepEqual([first.numbers, again.numbers], [[1, 2], []]);
  await grantTickets(db, { userId: 1, delta: -2, reason: 'purchase_revoke', sourceKey: 'purchase_revoke:10' });
  assert.equal((await getHalloweenSummary(db, 1)).tickets, 0);
  assert.deepEqual(await activeNumbers(db, 1), []);
  assert.deepEqual(await auditBalances(db), []);
  await db.query('UPDATE halloween_ticket_balance SET balance = 99 WHERE user_id = 1');
  assert.deepEqual(await auditBalances(db), [{ userId: 1, balance: 99, ledger: 0, active: 0 }]);
  await db.close();
});

test('every ticket gets its own serial number from 1, across users; retries never take a number', async () => {
  const db = await freshDb();
  const r1 = await grantTickets(db, { userId: 2, delta: 3, reason: 'purchase', sourceKey: 'purchase:1' });
  const r2 = await grantTickets(db, { userId: 1, delta: 1, reason: 'wheel', sourceKey: 'wheel:1' });
  const retry = await grantTickets(db, { userId: 2, delta: 3, reason: 'purchase', sourceKey: 'purchase:1' });
  const r3 = await grantQuestTicket(db, { userId: 3, code: 'q1', now: new Date('2026-10-14T10:00:00Z') });
  const r4 = await grantTickets(db, { userId: 2, delta: 2, reason: 'admin', sourceKey: 'admin:1' });
  assert.deepEqual([r1.numbers, r2.numbers, retry.numbers, r3.applied, r4.numbers], [[1, 2, 3], [4], [], true, [6, 7]]);
  await grantQuestTicket(db, { userId: 3, code: 'q1', now: new Date('2026-10-14T10:00:00Z') });
  const all = (await db.query('SELECT number, user_id, source_key, status FROM halloween_ticket ORDER BY number')).rows
    .map((r) => [Number(r.number), Number(r.user_id), r.source_key, r.status]);
  assert.deepEqual(all, [
    [1, 2, 'purchase:1', 'active'], [2, 2, 'purchase:1', 'active'], [3, 2, 'purchase:1', 'active'],
    [4, 1, 'wheel:1', 'active'], [5, 3, 'quest:2026-W42:q1', 'active'],
    [6, 2, 'admin:1', 'active'], [7, 2, 'admin:1', 'active']
  ]);
  assert.deepEqual(await auditBalances(db), []);
  await db.close();
});

test('a revocation voids the tickets of the original grant first, then the newest, never below zero', async () => {
  const db = await freshDb();
  await grantTickets(db, { userId: 1, delta: 2, reason: 'purchase', sourceKey: 'purchase:5' }); // 1, 2
  await grantTickets(db, { userId: 1, delta: 3, reason: 'purchase', sourceKey: 'purchase:6' }); // 3, 4, 5
  await grantTickets(db, { userId: 1, delta: 1, reason: 'invite', sourceKey: 'invite:9' }); // 6
  const cancel5 = await grantTickets(db, { userId: 1, delta: -2, reason: 'purchase_revoke', sourceKey: 'purchase-cancel:5' });
  assert.deepEqual([cancel5.applied, cancel5.delta, cancel5.numbers, cancel5.balance], [true, -2, [1, 2], 4]);
  assert.deepEqual(await activeNumbers(db, 1), [3, 4, 5, 6]);
  const cancelInvite = await grantTickets(db, { userId: 1, delta: -1, reason: 'invite_revoke', sourceKey: 'invite-cancel:9' });
  assert.deepEqual(cancelInvite.numbers, [6]);
  // explicit original that has only one ticket left: that one first, then the newest
  await grantTickets(db, { userId: 1, delta: -1, reason: 'admin', sourceKey: 'admin:fix', revokes: 'purchase:6' }); // newest of 6
  const mixed = await grantTickets(db, { userId: 1, delta: -2, reason: 'admin', sourceKey: 'admin:fix2', revokes: 'wheel:none' });
  assert.deepEqual(mixed.numbers, [3, 4]);
  // clamp: nothing left, nothing written, numbers untouched
  const empty = await grantTickets(db, { userId: 1, delta: -5, reason: 'admin', sourceKey: 'admin:fix3' });
  assert.deepEqual([empty.applied, empty.delta, empty.balance], [false, 0, 0]);
  assert.equal((await db.query(`SELECT COUNT(*)::int n FROM halloween_ticket_ledger WHERE source_key = 'admin:fix3'`)).rows[0].n, 0);
  await grantTickets(db, { userId: 1, delta: 2, reason: 'wheel', sourceKey: 'wheel:2' }); // 7, 8
  const partial = await grantTickets(db, { userId: 1, delta: -5, reason: 'purchase_revoke', sourceKey: 'purchase-cancel:6' });
  assert.deepEqual([partial.delta, partial.numbers, partial.balance], [-2, [7, 8], 0]);
  const retry = await grantTickets(db, { userId: 1, delta: -5, reason: 'purchase_revoke', sourceKey: 'purchase-cancel:6' });
  assert.equal(retry.applied, false);
  const voided = (await db.query(`SELECT number, void_source_key FROM halloween_ticket WHERE number IN (1, 6) ORDER BY number`)).rows;
  assert.deepEqual(voided.map((r) => r.void_source_key), ['purchase-cancel:5', 'invite-cancel:9']);
  assert.equal((await db.query(`SELECT COUNT(*)::int n FROM halloween_ticket WHERE status = 'void' AND voided_at IS NULL`)).rows[0].n, 0);
  assert.deepEqual(await auditBalances(db), []);
  // audit also catches a ticket voided behind the ledger's back
  await grantTickets(db, { userId: 2, delta: 1, reason: 'wheel', sourceKey: 'wheel:3' });
  await db.query(`UPDATE halloween_ticket SET status = 'void', voided_at = NOW() WHERE source_key = 'wheel:3'`);
  assert.deepEqual(await auditBalances(db), [{ userId: 2, balance: 1, ledger: 1, active: 0 }]);
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

const seedOf = (i) => i.toString(16).padStart(64, '0');
const ticketsOf = (counts) => {
  let number = 0;
  return Object.entries(counts).flatMap(([userId, n]) => Array.from({ length: n }, () => ({ number: ++number, userId: Number(userId) })));
};
const winnersOf = (r) => ({
  places: ['first', 'second', 'third'].filter((p) => r[p]).map((p) => r[p].userId),
  frames: r.frames.map((f) => f.userId)
});

test('places are drawn 1st, 2nd, 3rd by ticket; frames go to distinct people and may include place winners', () => {
  const tickets = ticketsOf({ 1: 50, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1 });
  const r = pickResults(tickets, createSeededRandomInt('01'.repeat(32)));
  const { places, frames } = winnersOf(r);
  assert.equal(new Set(places).size, 3);
  assert.equal(frames.length, 5);
  assert.equal(new Set(frames).size, 5);
  assert.deepEqual(r.drawOrder, ['first', 'second', 'third', 'frame1', 'frame2', 'frame3', 'frame4', 'frame5']);
  assert.deepEqual(r.revealOrder, ['frame1', 'frame2', 'frame3', 'frame4', 'frame5', 'third', 'second', 'first']);
  assert.deepEqual(r.frames.map((f) => f.slot), ['frame1', 'frame2', 'frame3', 'frame4', 'frame5']);
  for (const w of [r.first, r.second, r.third, ...r.frames]) {
    assert.equal(tickets.find((t) => t.number === w.ticket).userId, w.userId, 'winning ticket belongs to the winner');
  }
  assert.doesNotMatch(JSON.stringify(r), /percent|chance|odds|probab/i);

  let overlap = 0;
  const firsts = new Map();
  for (let i = 0; i < 300; i += 1) {
    const x = pickResults(tickets, createSeededRandomInt(seedOf(i)));
    const w = winnersOf(x);
    assert.equal(new Set(w.places).size, w.places.length, 'one place per person');
    assert.equal(new Set(w.frames).size, w.frames.length, 'one frame per person');
    if (w.frames.some((u) => w.places.includes(u))) overlap += 1;
    firsts.set(x.first.userId, (firsts.get(x.first.userId) || 0) + 1);
  }
  assert.ok(overlap > 0, 'a place winner can also win a frame');
  // ticket-weighted: the holder of most tickets takes 1st place more often than anybody else
  const [top] = [...firsts.entries()].sort((a, b) => b[1] - a[1]);
  assert.equal(top[0], 1);
  assert.ok([...firsts.keys()].length > 1, 'others can win too');
});

test('the result depends only on seed and ticket list, not on input order', () => {
  const tickets = ticketsOf({ 1: 3, 2: 5, 3: 2, 4: 1, 5: 4, 6: 2, 7: 1 });
  const seed = 'cd'.repeat(32);
  const a = pickResults(tickets, createSeededRandomInt(seed));
  const b = pickResults([...tickets].reverse(), createSeededRandomInt(seed));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, pickResults(tickets, createSeededRandomInt('ce'.repeat(32))));
  assert.throws(() => pickResults([{ number: 1, userId: 1 }, { number: 1, userId: 2 }], createSeededRandomInt(seed)), RangeError);
});

test('few participants: fewer places, frames limited to the number of people', () => {
  const rnd = () => createSeededRandomInt('02'.repeat(32));
  assert.deepEqual(pickResults([], rnd()), { frames: [], drawOrder: [], revealOrder: [] });
  const one = pickResults(ticketsOf({ 7: 2 }), rnd());
  assert.deepEqual([one.first.userId, one.second, one.third], [7, undefined, undefined]);
  assert.deepEqual(one.frames.map((f) => f.userId), [7]);
  assert.deepEqual(one.revealOrder, ['frame1', 'first']);
  const two = pickResults(ticketsOf({ 7: 1, 8: 9 }), rnd());
  assert.deepEqual(new Set([two.first.userId, two.second.userId]), new Set([7, 8]));
  assert.equal(two.third, undefined);
  assert.deepEqual(new Set(two.frames.map((f) => f.userId)), new Set([7, 8]));
  assert.deepEqual(two.revealOrder, ['frame1', 'frame2', 'second', 'first']);
  const three = pickResults(ticketsOf({ 1: 1, 2: 1, 3: 1 }), rnd());
  assert.deepEqual(three.revealOrder, ['frame1', 'frame2', 'frame3', 'third', 'second', 'first']);
  assert.equal(new Set([three.first, three.second, three.third].map((w) => w.userId)).size, 3);
});

test('close freezes the active ticket numbers and the hash, draw runs once and is reproducible', async () => {
  const db = await freshDb();
  const give = { 1: 5, 2: 3, 3: 1, 4: 2 };
  for (const [u, n] of Object.entries(give)) await grantTickets(db, { userId: Number(u), delta: n, reason: 'admin', sourceKey: `admin:${u}` });
  await grantTickets(db, { userId: 1, delta: -1, reason: 'admin', sourceKey: 'admin:1:fix' }); // voids number 5
  await rejects(drawNight(db), 'not_closed');
  await rejects(closeDraw(db), 'not_due');
  await db.query(`UPDATE halloween_draw SET closes_at = NOW() - INTERVAL '1 second'`);
  const closed = await closeDraw(db);
  assert.match(closed.snapshotHash, /^[0-9a-f]{64}$/);
  assert.deepEqual([closed.participants, closed.tickets], [4, 10]);
  const frozen = (await db.query('SELECT number, user_id FROM halloween_draw_snapshot_ticket ORDER BY number')).rows
    .map((r) => ({ number: Number(r.number), userId: Number(r.user_id) }));
  assert.deepEqual(frozen.map((t) => t.number), [1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
  assert.equal(snapshotHash(frozen), closed.snapshotHash);
  assert.equal((await closeDraw(db)).closed, false);
  await grantTickets(db, { userId: 3, delta: 100, reason: 'admin', sourceKey: 'admin:late' });
  const seed = '77'.repeat(32);
  const night = await drawNight(db, { seed });
  assert.equal(night.snapshotHash, closed.snapshotHash);
  assert.equal(night.results.frames.length, 4);
  assert.ok(night.results.frames.every((f) => frozen.some((t) => t.number === f.ticket && t.userId === f.userId)));
  assert.deepEqual(night.results.revealOrder, ['frame1', 'frame2', 'frame3', 'frame4', 'third', 'second', 'first']);
  await rejects(drawNight(db), 'not_closed');
  const stored = await db.query('SELECT seed, results FROM halloween_draw');
  assert.equal(stored.rows[0].seed, seed);
  assert.deepEqual(stored.rows[0].results, night.results);
  assert.deepEqual(pickResults(frozen, createSeededRandomInt(seed)), night.results);
  await db.close();
});

test('draw refuses a snapshot that changed after close', async () => {
  const db = await freshDb();
  await grantTickets(db, { userId: 1, delta: 2, reason: 'admin', sourceKey: 'admin:1' });
  await grantTickets(db, { userId: 2, delta: 2, reason: 'admin', sourceKey: 'admin:2' });
  await closeDraw(db, { force: true });
  await db.query('DELETE FROM halloween_draw_snapshot_ticket WHERE number = 1');
  await rejects(drawNight(db), 'snapshot_mismatch');
  assert.equal((await db.query('SELECT status FROM halloween_draw')).rows[0].status, 'closed');
  await db.close();
});

test('a seed must be 64 hex characters: "0x...", phrases and short seeds are refused, the draw stays closed', async () => {
  for (const bad of ['0x' + 'ab'.repeat(31), 'zz-not-hex', '', 'ab'.repeat(31), 'ab'.repeat(33), 'g'.repeat(64), null]) {
    assert.throws(() => createSeededRandomInt(bad), RangeError, String(bad));
  }
  assert.doesNotThrow(() => createSeededRandomInt('AB'.repeat(32)));
  const db = await freshDb();
  await grantTickets(db, { userId: 1, delta: 2, reason: 'admin', sourceKey: 'admin:1' });
  await closeDraw(db, { force: true });
  await assert.rejects(drawNight(db, { seed: 'halloween-2026' }), RangeError);
  assert.deepEqual((await db.query('SELECT status, seed FROM halloween_draw')).rows[0], { status: 'closed', seed: null });
  assert.equal((await drawNight(db)).results.first.userId, 1); // the default seed is valid hex
  await db.close();
});
