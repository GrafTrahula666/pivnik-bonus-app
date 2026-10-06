import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { auditBalances, getHalloweenSummary, grantTickets } from '../halloween-raffle.js';
import {
  claimInvite, deriveInviteCode, ensureInviteCode, getInviteSummary, inviteCodeFromStartParam, inviteLinkConfigFromEnv,
  inviteLinks, normalizeInviteCode, recordCancellation, recordPurchase, runHalloweenHook
} from '../halloween-invite.js';

const SECRET = Buffer.from('test-secret-test-secret-test-sec');
const NOW = new Date('2026-10-14T12:00:00Z'); // Wednesday of 2026-W42
const LINKS = { telegramBotUsername: 'pivnik_bot', telegramMiniAppShortName: 'app', vkAppId: '54694987' };

async function baseDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY, name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ, merged_into_user_id BIGINT
    );
    CREATE TABLE transactions (
      id BIGSERIAL PRIMARY KEY, client_id BIGINT NOT NULL REFERENCES users(id), staff_id BIGINT,
      mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', check_amount_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  return db;
}

async function freshDb() {
  const db = await baseDb();
  await db.exec(await readFile(new URL('../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
  return db;
}

async function addUser(db, { hoursOld = 1 } = {}) {
  const { rows } = await db.query(
    `INSERT INTO users (name, created_at) VALUES ('u', $1::timestamptz - make_interval(hours => $2)) RETURNING id`,
    [NOW.toISOString(), hoursOld]
  );
  return Number(rows[0].id);
}

async function purchase(db, userId, rub, { at = NOW, mode = 'accrue' } = {}) {
  const { rows } = await db.query(
    `INSERT INTO transactions (client_id, staff_id, mode, check_amount_cents, created_at)
     VALUES ($1, 1, $2, $3, $4::timestamptz) RETURNING id`,
    [userId, mode, Math.round(rub * 100), new Date(at).toISOString()]
  );
  return Number(rows[0].id);
}

async function cancel(db, txId) {
  await db.query(`UPDATE transactions SET status = 'cancelled' WHERE id = $1`, [txId]);
}

const tickets = async (db, userId) => (await getHalloweenSummary(db, userId)).tickets;
const summary = (db, userId, now = NOW) => getInviteSummary(db, { userId, secret: SECRET, links: LINKS, now });
const claim = (db, inviteeId, code) => claimInvite(db, { inviteeId, code, now: NOW });

test('migration 011 with invite tables is still repeatable', async () => {
  const db = await freshDb();
  await db.exec(await readFile(new URL('../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
  const u = await addUser(db);
  await grantTickets(db, { userId: u, delta: 1, reason: 'invite', sourceKey: 'invite:x' });
  await grantTickets(db, { userId: u, delta: -1, reason: 'invite_revoke', sourceKey: 'invite-cancel:x' });
  await db.close();
});

test('invite code is stable, base32, resolvable and survives a secret change', async () => {
  const db = await freshDb();
  const u = await addUser(db);
  const a = await summary(db, u);
  const b = await summary(db, u);
  assert.match(a.invite.code, /^[A-Z2-7]{8}$/);
  assert.equal(a.invite.code, b.invite.code);
  assert.equal(a.invite.code, deriveInviteCode(SECRET, u));
  assert.equal(await ensureInviteCode(db, { userId: u, secret: Buffer.from('another-secret') }), a.invite.code);
  assert.notEqual(deriveInviteCode(SECRET, u + 1), a.invite.code);
  assert.deepEqual(a.invite.links, {
    telegram: `https://t.me/pivnik_bot/app?startapp=inv_${a.invite.code}`,
    vk: `https://vk.com/app54694987#inv_${a.invite.code}`
  });
  assert.deepEqual([a.invite.weekCount, a.invite.weekLimit, a.tickets, a.status], [0, 3, 0, 'open']);
  assert.doesNotMatch(JSON.stringify(a), /percent|chance|odds/i);
  await db.close();
});

test('links are null when not configured, never guessed', () => {
  assert.deepEqual(inviteLinks('ABCDEFGH', {}), { telegram: null, vk: null });
  assert.deepEqual(inviteLinks('ABCDEFGH', { telegramBotUsername: 'pivnik_bot', vkAppId: '' }), { telegram: null, vk: null });
  assert.deepEqual(
    inviteLinkConfigFromEnv({ TELEGRAM_BOT_USERNAME: '@pivnik_bot', TELEGRAM_MINI_APP_SHORT_NAME: 'app', VK_APP_ID: '54694987' }),
    LINKS
  );
});

test('code parsing accepts inv_ prefix and the signed Telegram start_param', () => {
  assert.equal(normalizeInviteCode('inv_abcdefgh'), 'ABCDEFGH');
  assert.equal(normalizeInviteCode('ABC'), null);
  assert.equal(normalizeInviteCode("x'; DROP"), null);
  assert.equal(inviteCodeFromStartParam('user=%7B%7D&start_param=inv_ABCD2345&hash=00'), 'ABCD2345');
  assert.equal(inviteCodeFromStartParam('user=%7B%7D&start_param=promo&hash=00'), null);
  assert.equal(inviteCodeFromStartParam(''), null);
});

test('summary falls back without the migration: 200-style payload, zero tickets, invite object', async () => {
  const db = await baseDb();
  const u = await addUser(db);
  const s = await summary(db, u);
  assert.deepEqual(s, {
    tickets: 0, status: 'open', closesAt: '2026-10-31T20:00:00+03:00',
    invite: { code: deriveInviteCode(SECRET, u), weekCount: 0, weekLimit: 3, links: inviteLinks(deriveInviteCode(SECRET, u), LINKS) }
  });
  assert.deepEqual(await claim(db, u, 'ABCDEFGH'), { attached: false, reason: 'unavailable' });
  const tx = await purchase(db, u, 5000);
  const hooked = await runHalloweenHook({ connect: async () => Object.assign(db, { release() {} }) }, 'purchase',
    (client) => recordPurchase(client, { transactionId: tx, now: NOW }), { warn: () => assert.fail('must be silent') });
  assert.equal(hooked, null);
  await db.close();
});

test('claim: self-invite, unknown code, old account and buyer are rejected; one inviter forever', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const other = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const { invite: otherInvite } = await summary(db, other);

  assert.deepEqual(await claim(db, inviter, invite.code), { attached: false, reason: 'self_invite' });
  assert.deepEqual(await claim(db, inviter, 'zzzz'), { attached: false, reason: 'invalid_code' });
  assert.deepEqual(await claim(db, inviter, 'AAAAAAAA'), { attached: false, reason: 'unknown_code' });

  const old = await addUser(db, { hoursOld: 49 });
  assert.deepEqual(await claim(db, old, invite.code), { attached: false, reason: 'not_new_account' });

  const buyer = await addUser(db, { hoursOld: 2 });
  await purchase(db, buyer, 300);
  assert.deepEqual(await claim(db, buyer, invite.code), { attached: false, reason: 'has_purchase' });

  const friend = await addUser(db, { hoursOld: 47 });
  assert.deepEqual(await claim(db, friend, `inv_${invite.code.toLowerCase()}`), { attached: true });
  assert.deepEqual(await claim(db, friend, invite.code), { attached: false, reason: 'already_attached' });
  assert.deepEqual(await claim(db, friend, otherInvite.code), { attached: false, reason: 'already_attached' });
  const rows = (await db.query('SELECT inviter_id FROM halloween_invite WHERE invitee_id = $1', [friend])).rows;
  assert.deepEqual(rows.map((r) => Number(r.inviter_id)), [inviter]);

  const friendCode = (await summary(db, friend)).invite.code;
  const late = await addUser(db, { hoursOld: 1 });
  assert.deepEqual(await claimInvite(db, { inviteeId: late, code: friendCode, channel: 'telegram_start_param', now: NOW }), { attached: true });
  assert.equal((await db.query('SELECT channel FROM halloween_invite WHERE invitee_id = $1', [late])).rows[0].channel, 'telegram_start_param');

  await db.query(`UPDATE halloween_draw SET status = 'closed'`);
  const tooLate = await addUser(db, { hoursOld: 1 });
  assert.deepEqual(await claim(db, tooLate, invite.code), { attached: false, reason: 'draw_closed' });
  await db.close();
});

test('purchase tickets: one per full 1000 rub, once per transaction, only while the draw is open', async () => {
  const db = await freshDb();
  const u = await addUser(db, { hoursOld: 500 });
  const t1 = await purchase(db, u, 2999.99);
  const t2 = await purchase(db, u, 999);
  const t3 = await purchase(db, u, 1000, { mode: 'redeem' });
  for (const tx of [t1, t1, t2, t3]) await recordPurchase(db, { transactionId: tx, now: NOW });
  assert.equal(await tickets(db, u), 3);
  const adj = (await db.query(`INSERT INTO transactions (client_id, mode, check_amount_cents) VALUES ($1, 'adjustment', 500000) RETURNING id`, [u])).rows[0].id;
  assert.deepEqual(await recordPurchase(db, { transactionId: adj, now: NOW }), { skipped: 'not_a_purchase' });
  const t4 = await purchase(db, u, 5000);
  assert.deepEqual(await recordPurchase(db, { transactionId: t4, now: new Date('2026-10-31T17:00:01Z') }), { skipped: 'draw_closed' });
  assert.equal(await tickets(db, u), 3);
  assert.deepEqual(await auditBalances(db), []);
  await db.close();
});

test('first purchase grants the inviter one ticket, once per friend; later purchases do not', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const friend = await addUser(db);
  await claim(db, friend, invite.code);
  const t1 = await purchase(db, friend, 1500);
  const r1 = await recordPurchase(db, { transactionId: t1, now: NOW });
  assert.deepEqual([r1.purchaseTickets, r1.invite.granted, r1.invite.week], [1, true, '2026-W42']);
  await recordPurchase(db, { transactionId: t1, now: NOW });
  const t2 = await purchase(db, friend, 200);
  const r2 = await recordPurchase(db, { transactionId: t2, now: NOW });
  assert.equal(r2.invite, null);
  assert.equal(await tickets(db, inviter), 1);
  assert.equal(await tickets(db, friend), 1);
  assert.equal((await summary(db, inviter)).invite.weekCount, 1);
  assert.equal((await summary(db, inviter, new Date('2026-10-20T12:00:00Z'))).invite.weekCount, 0);
  await db.close();
});

test('weekly cap: at most 3 invite tickets per inviter per week, next week counts again', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const results = [];
  for (let i = 0; i < 4; i += 1) {
    const friend = await addUser(db);
    assert.deepEqual(await claim(db, friend, invite.code), { attached: true });
    const tx = await purchase(db, friend, 100);
    results.push((await recordPurchase(db, { transactionId: tx, now: NOW })).invite.reason);
  }
  assert.deepEqual(results, ['granted', 'granted', 'granted', 'weekly_limit']);
  assert.equal(await tickets(db, inviter), 3);
  assert.equal((await summary(db, inviter)).invite.weekCount, 3);
  const capped = (await db.query(`SELECT COUNT(*)::int n FROM halloween_invite WHERE status = 'capped'`)).rows[0].n;
  assert.equal(capped, 1);

  const nextWeek = new Date('2026-10-19T12:00:00Z');
  const friend = await addUser(db);
  await claim(db, friend, invite.code);
  const tx = await purchase(db, friend, 100, { at: nextWeek });
  assert.equal((await recordPurchase(db, { transactionId: tx, now: nextWeek })).invite.reason, 'granted');
  assert.equal((await summary(db, inviter, nextWeek)).invite.weekCount, 1);
  assert.equal(await tickets(db, inviter), 4);
  await db.close();
});

test('cancel revokes the purchase tickets and the inviter ticket, never below zero, idempotent', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const friend = await addUser(db);
  await claim(db, friend, invite.code);
  const t1 = await purchase(db, friend, 3200);
  await recordPurchase(db, { transactionId: t1, now: NOW });
  assert.deepEqual([await tickets(db, friend), await tickets(db, inviter)], [3, 1]);

  assert.deepEqual(await recordCancellation(db, { transactionId: t1, now: NOW }), { skipped: 'not_cancelled' });
  await cancel(db, t1);
  assert.deepEqual(await recordCancellation(db, { transactionId: t1, now: NOW }), { purchaseRevoked: 3, inviteRevoked: 1 });
  assert.deepEqual(await recordCancellation(db, { transactionId: t1, now: NOW }), { purchaseRevoked: 0, inviteRevoked: 0 });
  assert.deepEqual([await tickets(db, friend), await tickets(db, inviter)], [0, 0]);
  assert.equal((await summary(db, inviter)).invite.weekCount, 0);
  // the friend's next purchase does not re-qualify a revoked invite
  const t2 = await purchase(db, friend, 1000);
  const r2 = await recordPurchase(db, { transactionId: t2, now: NOW });
  assert.deepEqual([r2.purchaseTickets, r2.invite], [1, null]);
  assert.equal(await tickets(db, inviter), 0);

  // never below zero: only what is left is taken back
  const buyer = await addUser(db, { hoursOld: 500 });
  const t3 = await purchase(db, buyer, 2000);
  await recordPurchase(db, { transactionId: t3, now: NOW });
  await grantTickets(db, { userId: buyer, delta: -1, reason: 'admin', sourceKey: 'admin:spent' });
  await cancel(db, t3);
  assert.equal((await recordCancellation(db, { transactionId: t3, now: NOW })).purchaseRevoked, 1);
  assert.equal(await tickets(db, buyer), 0);
  assert.deepEqual(await auditBalances(db), []);
  await db.close();
});

test('cancelling a later purchase keeps the inviter ticket of the first one', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const friend = await addUser(db);
  await claim(db, friend, invite.code);
  const t1 = await purchase(db, friend, 100);
  await recordPurchase(db, { transactionId: t1, now: NOW });
  const t2 = await purchase(db, friend, 1000);
  await recordPurchase(db, { transactionId: t2, now: NOW });
  await cancel(db, t2);
  assert.deepEqual(await recordCancellation(db, { transactionId: t2, now: NOW }), { purchaseRevoked: 1, inviteRevoked: 0 });
  assert.equal(await tickets(db, inviter), 1);
  assert.equal((await summary(db, inviter)).invite.weekCount, 1);
  await db.close();
});

test('hook runner never throws and logs unexpected errors', async () => {
  const warnings = [];
  const pool = { connect: async () => ({ query: async () => { throw new Error('boom'); }, release() {} }) };
  const out = await runHalloweenHook(pool, 'purchase', (client) => recordPurchase(client, { transactionId: 1 }), { warn: (...a) => warnings.push(a.join(' ')) });
  assert.equal(out, null);
  assert.deepEqual(warnings, ['Halloween purchase skipped: boom']);
  const failingPool = { connect: async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); } };
  assert.equal(await runHalloweenHook(failingPool, 'cancel', async () => 1, { warn: () => {} }), null);
});
