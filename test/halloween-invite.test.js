import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { auditBalances, closeDraw, drawNight, getHalloweenSummary, grantTickets, snapshotHash } from '../halloween-raffle.js';
import {
  claimInvite, deletedIdentityHash, deriveInviteCode, ensureInviteCode, getInviteSummary, identityTombstoneSecretFromEnv,
  INVITE_BONUS, INVITE_NEW_ACCOUNT_HOURS, inviteCodeFromStartParam, inviteLinkConfigFromEnv, inviteLinks,
  normalizeInviteCode, recordCancellation, recordPurchase, recordPurchaseReturn, runHalloweenHook
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
      id BIGSERIAL PRIMARY KEY, request_key TEXT UNIQUE, client_id BIGINT NOT NULL REFERENCES users(id), staff_id BIGINT,
      mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', check_amount_cents BIGINT NOT NULL DEFAULT 0,
      bonus_spent BIGINT NOT NULL DEFAULT 0, bonus_earned BIGINT NOT NULL DEFAULT 0, balance_after BIGINT, reason TEXT,
      completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE wallets (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  // hoursOld may be fractional (make_interval takes double precision seconds)
  const { rows } = await db.query(
    `INSERT INTO users (name, created_at) VALUES ('u', $1::timestamptz - make_interval(secs => $2::float8 * 3600)) RETURNING id`,
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
const wallet = async (db, userId) => Number((await db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId])).rows[0]?.balance ?? 0);
const bonusRows = async (db, userId) => (await db.query(
  `SELECT request_key, mode, status, staff_id, bonus_earned, bonus_spent, balance_after, reason
   FROM transactions WHERE client_id = $1 AND mode = 'adjustment' ORDER BY id`, [userId]
)).rows.map((r) => ({ ...r, bonus_earned: Number(r.bonus_earned), bonus_spent: Number(r.bonus_spent), balance_after: Number(r.balance_after) }));
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
    invite: {
      code: deriveInviteCode(SECRET, u), weekCount: 0, weekLimit: 3, bonusPerFriend: 100,
      links: inviteLinks(deriveInviteCode(SECRET, u), LINKS), canEnterCode: false, enterUntil: null, invitedBy: false
    }
  });
  assert.deepEqual(await claim(db, u, 'ABCDEFGH'), { attached: false, reason: 'unavailable' });
  const tx = await purchase(db, u, 5000);
  const hooked = await runHalloweenHook({ connect: async () => Object.assign(db, { release() {} }) }, 'purchase',
    (client) => recordPurchase(client, { transactionId: tx, now: NOW }), { warn: () => assert.fail('must be silent') });
  assert.equal(hooked, null);
  await db.close();
});

test('claim: self-invite, unknown code, expired 24h window and buyer are rejected; one inviter forever', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const other = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const { invite: otherInvite } = await summary(db, other);

  assert.deepEqual(await claim(db, inviter, invite.code), { attached: false, reason: 'self_invite' });
  assert.deepEqual(await claim(db, inviter, 'zzzz'), { attached: false, reason: 'invalid_code' });
  assert.deepEqual(await claim(db, inviter, 'AAAAAAAA'), { attached: false, reason: 'unknown_code' });

  assert.equal(INVITE_NEW_ACCOUNT_HOURS, 24);
  const old = await addUser(db, { hoursOld: 24.01 });
  assert.deepEqual(await claim(db, old, invite.code), { attached: false, reason: 'window_expired' });
  const oldBuyer = await addUser(db, { hoursOld: 30 });
  await purchase(db, oldBuyer, 300);
  assert.deepEqual(await claim(db, oldBuyer, invite.code), { attached: false, reason: 'window_expired' });

  const buyer = await addUser(db, { hoursOld: 2 });
  await purchase(db, buyer, 300);
  assert.deepEqual(await claim(db, buyer, invite.code), { attached: false, reason: 'has_purchase' });

  const friend = await addUser(db, { hoursOld: 23.9 });
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
  assert.deepEqual(await recordCancellation(db, { transactionId: t1, now: NOW }), { purchaseRevoked: 3, inviteRevoked: 1, inviteBonusRevoked: 100 });
  assert.deepEqual(await recordCancellation(db, { transactionId: t1, now: NOW }), { purchaseRevoked: 0, inviteRevoked: 0, inviteBonusRevoked: 0 });
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
  assert.deepEqual(await recordCancellation(db, { transactionId: t2, now: NOW }), { purchaseRevoked: 1, inviteRevoked: 0, inviteBonusRevoked: 0 });
  assert.equal(await wallet(db, inviter), INVITE_BONUS);
  assert.equal(await tickets(db, inviter), 1);
  assert.equal((await summary(db, inviter)).invite.weekCount, 1);
  await db.close();
});

test('summary: a friend can enter a code only in the first 24 hours, before buying, once', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  assert.deepEqual([invite.canEnterCode, invite.enterUntil, invite.invitedBy, invite.bonusPerFriend], [false, null, false, 100]);

  const friend = await addUser(db, { hoursOld: 2 });
  const before = (await summary(db, friend)).invite;
  assert.deepEqual([before.canEnterCode, before.enterUntil, before.invitedBy], [true, '2026-10-15T10:00:00.000Z', false]);
  // the window closes exactly 24 hours after registration
  const atEnd = (await summary(db, friend, new Date('2026-10-15T10:00:00Z'))).invite;
  assert.deepEqual([atEnd.canEnterCode, atEnd.enterUntil], [false, null]);
  assert.deepEqual(await claimInvite(db, { inviteeId: friend, code: invite.code, now: new Date('2026-10-15T10:00:00Z') }),
    { attached: false, reason: 'window_expired' });

  assert.deepEqual(await claim(db, friend, invite.code.toLowerCase()), { attached: true });
  const after = (await summary(db, friend)).invite;
  assert.deepEqual([after.canEnterCode, after.enterUntil, after.invitedBy], [false, null, true]);

  const buyer = await addUser(db, { hoursOld: 1 });
  await purchase(db, buyer, 100);
  assert.deepEqual([(await summary(db, buyer)).invite.canEnterCode, (await summary(db, buyer)).invite.invitedBy], [false, false]);

  const late = await addUser(db, { hoursOld: 1 });
  assert.equal((await summary(db, late)).invite.canEnterCode, true);
  await db.query(`UPDATE halloween_draw SET status = 'closed'`);
  assert.deepEqual([(await summary(db, late)).invite.canEnterCode, (await summary(db, late)).invite.enterUntil], [false, null]);
  assert.doesNotMatch(JSON.stringify(await summary(db, late)), /percent|chance|odds/i);
  await db.close();
});

test('inviter bonus: 100 once per friend through the wallet and an adjustment row, within the weekly cap', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  await db.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 40)', [inviter]);
  const { invite } = await summary(db, inviter);
  const friends = [];
  const bonuses = [];
  for (let i = 0; i < 4; i += 1) {
    const friend = await addUser(db);
    friends.push(friend);
    await claim(db, friend, invite.code);
    const tx = await purchase(db, friend, 100);
    bonuses.push((await recordPurchase(db, { transactionId: tx, now: NOW })).invite.bonus ?? 0);
    await recordPurchase(db, { transactionId: tx, now: NOW }); // retry: nothing new
    const tx2 = await purchase(db, friend, 100);
    await recordPurchase(db, { transactionId: tx2, now: NOW }); // later purchase: nothing new
  }
  assert.deepEqual(bonuses, [100, 100, 100, 0]); // 4th friend: weekly cap, no ticket and no bonus
  assert.equal(await wallet(db, inviter), 40 + 3 * INVITE_BONUS);
  const rows = await bonusRows(db, inviter);
  assert.deepEqual(rows.map((r) => r.request_key), friends.slice(0, 3).map((f) => `halloween-invite-bonus:${f}`));
  assert.deepEqual(rows[0], {
    request_key: `halloween-invite-bonus:${friends[0]}`, mode: 'adjustment', status: 'completed', staff_id: null,
    bonus_earned: 100, bonus_spent: 0, balance_after: 140, reason: 'Бонус за друга'
  });
  assert.deepEqual(rows.map((r) => r.balance_after), [140, 240, 340]);
  for (const f of friends) assert.equal(await wallet(db, f), 0);
  await db.close();
});

test('inviter bonus is taken back when the qualifying purchase is cancelled, never below zero', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const friendA = await addUser(db);
  const friendB = await addUser(db);
  await claim(db, friendA, invite.code);
  await claim(db, friendB, invite.code);
  const ta = await purchase(db, friendA, 1000);
  const tb = await purchase(db, friendB, 1000);
  await recordPurchase(db, { transactionId: ta, now: NOW });
  await recordPurchase(db, { transactionId: tb, now: NOW });
  assert.equal(await wallet(db, inviter), 200);

  await cancel(db, ta);
  assert.equal((await recordCancellation(db, { transactionId: ta, now: NOW })).inviteBonusRevoked, 100);
  assert.equal((await recordCancellation(db, { transactionId: ta, now: NOW })).inviteBonusRevoked, 0);
  assert.equal(await wallet(db, inviter), 100);
  const revoke = (await bonusRows(db, inviter)).at(-1);
  assert.deepEqual([revoke.request_key, revoke.bonus_spent, revoke.bonus_earned, revoke.balance_after, revoke.reason],
    [`halloween-invite-bonus-cancel:${friendA}`, 100, 0, 100, 'Отмена бонуса за друга']);

  // the inviter already spent most of the bonus: only what is left is taken back
  await db.query('UPDATE wallets SET balance = 30 WHERE user_id = $1', [inviter]);
  await cancel(db, tb);
  assert.deepEqual(await recordCancellation(db, { transactionId: tb, now: NOW }), { purchaseRevoked: 1, inviteRevoked: 1, inviteBonusRevoked: 30 });
  assert.equal(await wallet(db, inviter), 0);
  // a revoked friend never earns the bonus again
  const tb2 = await purchase(db, friendB, 1000);
  assert.equal((await recordPurchase(db, { transactionId: tb2, now: NOW })).invite, null);
  assert.equal(await wallet(db, inviter), 0);
  assert.deepEqual(await auditBalances(db), []);
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

test('a re-created account (deleted identity tombstone) cannot enter a code: returning_user', async () => {
  const db = await freshDb();
  await db.exec(`
    CREATE TABLE user_identities (user_id BIGINT NOT NULL REFERENCES users(id), provider TEXT NOT NULL, provider_user_id TEXT NOT NULL);
    CREATE TABLE deleted_identity_tombstones (provider TEXT NOT NULL, identity_hash TEXT NOT NULL, PRIMARY KEY (provider, identity_hash));
  `);
  const tombstoneSecret = identityTombstoneSecretFromEnv({ IDENTITY_TOMBSTONE_SECRET: 'tombstone-secret-tombstone-secret-0' });
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const returning = await addUser(db);
  await db.query(`INSERT INTO user_identities VALUES ($1, 'telegram', '8102')`, [returning]);
  await db.query(`INSERT INTO deleted_identity_tombstones VALUES ('telegram', $1)`, [deletedIdentityHash(tombstoneSecret, 'telegram', '8102')]);
  const fresh = await addUser(db);
  await db.query(`INSERT INTO user_identities VALUES ($1, 'telegram', '8103')`, [fresh]);
  for (const channel of ['claim', 'telegram_start_param']) {
    assert.deepEqual(await claimInvite(db, { inviteeId: returning, code: invite.code, channel, now: NOW, tombstoneSecret }),
      { attached: false, reason: 'returning_user' });
  }
  assert.deepEqual(await claimInvite(db, { inviteeId: fresh, code: invite.code, now: NOW, tombstoneSecret }), { attached: true });
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM halloween_invite')).rows[0].n, 1);
  await db.close();
});

test('tombstone secret matches the gateway derivation, and both claim paths pass it', async () => {
  const sha = (text) => crypto.createHash('sha256').update(text).digest();
  assert.deepEqual(identityTombstoneSecretFromEnv({ IDENTITY_TOMBSTONE_SECRET: 'x'.repeat(40), SESSION_SECRET: 's' }), sha('x'.repeat(40)));
  assert.deepEqual(identityTombstoneSecretFromEnv({ SESSION_SECRET: 's', TELEGRAM_BOT_TOKEN: 't' }), sha('pivnik-tombstone-development:s'));
  assert.deepEqual(identityTombstoneSecretFromEnv({ TELEGRAM_BOT_TOKEN: 't' }), sha('pivnik-tombstone-development:t'));
  assert.deepEqual(identityTombstoneSecretFromEnv({}), sha('pivnik-tombstone-development:local'));
  const [gateway, server] = await Promise.all(['universal-server.js', 'server.js'].map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8')));
  assert.match(gateway, /configuredIdentityTombstoneSecret\s*\|\| `pivnik-tombstone-development:\$\{configuredSessionSecret \|\| telegramBotToken \|\| 'local'\}`/);
  assert.match(gateway, /channel: 'telegram_start_param', tombstoneSecret: identityTombstoneSecret/);
  assert.equal(server.match(/tombstoneSecret: halloweenTombstoneSecret/g)?.length, 2);
});

test('hook transactions never wait long: lock_timeout 1s and statement_timeout 3s right after BEGIN', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const friend = await addUser(db);
  const seen = [];
  const recording = { query: (sql, params) => { seen.push(String(sql).trim()); return db.query(sql, params); } };
  const tx = await purchase(db, friend, 1000);
  await claimInvite(recording, { inviteeId: friend, code: invite.code, now: NOW });
  await recordPurchase(recording, { transactionId: tx, now: NOW });
  await cancel(db, tx);
  await recordCancellation(recording, { transactionId: tx, now: NOW });
  const begins = seen.flatMap((sql, i) => (sql === 'BEGIN' ? [seen.slice(i + 1, i + 3)] : []));
  assert.equal(begins.length, 3);
  for (const next of begins) assert.deepEqual(next, ["SET LOCAL lock_timeout = '1s'", "SET LOCAL statement_timeout = '3s'"]);
  await db.close();
});

test('no invite circles: a claim whose inviter chain leads back to the invitee is mutual_invite', async () => {
  const db = await freshDb();
  const [a, b, c, d] = [await addUser(db), await addUser(db), await addUser(db), await addUser(db)];
  const code = async (u) => (await summary(db, u)).invite.code;
  assert.deepEqual(await claim(db, b, await code(a)), { attached: true }); // a -> b
  assert.deepEqual(await claim(db, c, await code(b)), { attached: true }); // b -> c
  assert.deepEqual(await claim(db, d, await code(c)), { attached: true }); // c -> d
  assert.deepEqual(await claim(db, a, await code(b)), { attached: false, reason: 'mutual_invite' }); // direct
  assert.deepEqual(await claim(db, a, await code(d)), { attached: false, reason: 'mutual_invite' }); // a -> b -> c -> d -> a
  const e = await addUser(db);
  assert.deepEqual(await claim(db, a, await code(e)), { attached: true }); // an unrelated inviter is fine
  await db.close();
});

test('purchase hook locks the buyer and inviter balances in ascending user id order', async () => {
  const db = await freshDb();
  const friend = await addUser(db); // lower id than the inviter: the inviter's lock must still come second
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  await claim(db, friend, invite.code);
  const locked = [];
  const recording = { query: (sql, params) => {
    if (/FROM halloween_ticket_balance WHERE user_id = \$1 FOR UPDATE/.test(sql)) locked.push(Number(params[0]));
    return db.query(sql, params);
  } };
  const tx = await purchase(db, friend, 2000);
  const r = await recordPurchase(recording, { transactionId: tx, now: NOW });
  assert.deepEqual([r.purchaseTickets, r.invite.granted], [2, true]);
  assert.deepEqual(locked.slice(0, 2), [friend, inviter]);
  const other = await addUser(db, { hoursOld: 500 });
  const late = await addUser(db); // higher id than its inviter
  await claim(db, late, (await summary(db, other)).invite.code);
  locked.length = 0;
  await recordPurchase(recording, { transactionId: await purchase(db, late, 1000), now: NOW });
  assert.deepEqual(locked.slice(0, 2), [other, late]);
  assert.deepEqual(await auditBalances(db), []);
  await db.close();
});

test('cancel after closeDraw removes the voided numbers from the frozen list and re-hashes it; a drawn result is final', async () => {
  const db = await freshDb();
  const inviter = await addUser(db, { hoursOld: 500 });
  const { invite } = await summary(db, inviter);
  const friend = await addUser(db);
  await claim(db, friend, invite.code);
  const other = await addUser(db, { hoursOld: 500 });
  const t1 = await purchase(db, friend, 3000);
  const t2 = await purchase(db, other, 2000);
  const t3 = await purchase(db, other, 1000);
  for (const tx of [t1, t2, t3]) await recordPurchase(db, { transactionId: tx, now: NOW });
  const closed = await closeDraw(db, { force: true });
  assert.equal(closed.tickets, 7); // friend 3, inviter 1, other 3

  await cancel(db, t1);
  const r = await recordCancellation(db, { transactionId: t1, now: NOW });
  assert.deepEqual(r, { purchaseRevoked: 3, inviteRevoked: 1, inviteBonusRevoked: 100, snapshotRemoved: 4 });
  const frozen = (await db.query('SELECT number, user_id FROM halloween_draw_snapshot_ticket ORDER BY number')).rows
    .map((row) => ({ number: Number(row.number), userId: Number(row.user_id) }));
  assert.deepEqual([...new Set(frozen.map((t) => t.userId))], [other]);
  assert.equal((await db.query('SELECT snapshot_hash FROM halloween_draw')).rows[0].snapshot_hash, snapshotHash(frozen));
  assert.deepEqual(await recordCancellation(db, { transactionId: t1, now: NOW }), { purchaseRevoked: 0, inviteRevoked: 0, inviteBonusRevoked: 0 });

  const night = await drawNight(db, { seed: '5a'.repeat(32) });
  assert.equal(night.results.first.userId, other);
  await cancel(db, t2);
  assert.deepEqual(await recordCancellation(db, { transactionId: t2, now: NOW }), { purchaseRevoked: 2, inviteRevoked: 0, inviteBonusRevoked: 0 });
  const after = await db.query('SELECT status, snapshot_hash, results FROM halloween_draw');
  assert.deepEqual([after.rows[0].status, after.rows[0].snapshot_hash, after.rows[0].results], ['drawn', snapshotHash(frozen), night.results]);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM halloween_draw_snapshot_ticket')).rows[0].n, frozen.length);
  await db.close();
});

test('staff cancel replay runs the cancel hook too, so a failed hook is repaired on retry', async () => {
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf("app.post('/api/staff/transactions/:id/cancel'");
  const replay = server.slice(server.indexOf('if (replay.rowCount) {', start), server.indexOf('const client = await pool.connect();', start));
  assert.ok(start >= 0 && replay.length > 0);
  assert.ok(replay.indexOf('await halloweenAfterCancel(replay.rows[0].id);') > replay.indexOf("status(409)"));
  assert.ok(replay.indexOf('await halloweenAfterCancel(replay.rows[0].id);') < replay.indexOf('return res.json({'));
});

test('missing migration 011 is reported once (not silently), and the hook still never throws', async () => {
  const db = await baseDb();
  const pool = { connect: async () => ({ query: db.query.bind(db), release() {} }) };
  const errors = [];
  const logger = { warn: () => assert.fail('a missing table is not an unexpected error'), error: (m) => errors.push(m) };
  const user = await addUser(db);
  const tx = await purchase(db, user, 1001);
  assert.equal(await runHalloweenHook(pool, 'purchase', (c) => recordPurchase(c, { transactionId: tx, now: NOW }), logger), null);
  assert.equal(await runHalloweenHook(pool, 'purchase', (c) => recordPurchase(c, { transactionId: tx, now: NOW }), logger), null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /011_halloween_raffle\.sql/);
  await db.close();
});

test('a 1001 rub purchase gives one ticket, and a purchase hook missed earlier can be run later', async () => {
  const db = await freshDb();
  const buyer = await addUser(db, { hoursOld: 500 });
  const tx = await purchase(db, buyer, 1001, { at: new Date(NOW.getTime() - 86_400_000) });
  assert.equal((await recordPurchase(db, { transactionId: tx, now: NOW })).purchaseTickets, 1);
  assert.equal((await recordPurchase(db, { transactionId: tx, now: NOW })).purchaseTickets, 0);
  assert.equal(await tickets(db, buyer), 1);
  await db.close();
});

test('partial returns keep one ticket per full 1000 rub not returned; a later cancel takes only the rest', async () => {
  const db = await freshDb();
  const buyer = await addUser(db, { hoursOld: 500 });
  const other = await purchase(db, buyer, 2000);
  await recordPurchase(db, { transactionId: other, now: NOW });
  const tx = await purchase(db, buyer, 3200);
  await recordPurchase(db, { transactionId: tx, now: NOW });
  assert.equal(await tickets(db, buyer), 5);

  assert.deepEqual(await recordPurchaseReturn(db, { transactionId: tx, returnedCents: 150_000, returnKey: 'bar:r1' }), { revoked: 2 });
  assert.deepEqual(await recordPurchaseReturn(db, { transactionId: tx, returnedCents: 150_000, returnKey: 'bar:r1' }), { revoked: 0 });
  assert.equal(await tickets(db, buyer), 3);
  // 3200 - 1700 = 1500 still keeps one ticket
  assert.deepEqual(await recordPurchaseReturn(db, { transactionId: tx, returnedCents: 170_000, returnKey: 'bar:r2' }), { revoked: 0 });
  await cancel(db, tx);
  assert.equal((await recordCancellation(db, { transactionId: tx, now: NOW })).purchaseRevoked, 1);
  assert.equal(await tickets(db, buyer), 2, 'the other purchase keeps its two tickets');
  assert.deepEqual(await recordPurchaseReturn(db, { transactionId: tx, returnedCents: 320_000, returnKey: 'bar:r3' }), { skipped: 'not_a_purchase' });
  assert.deepEqual(await auditBalances(db), []);
  await db.close();
});
