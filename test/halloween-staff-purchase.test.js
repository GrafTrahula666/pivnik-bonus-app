import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { createStaffTransactionPersistence } from '../staff-transaction-persistence.js';
import { recordPurchase, runHalloweenHook } from '../halloween-invite.js';
import { auditBalances } from '../halloween-raffle.js';
const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const route = source.slice(source.indexOf("app.post('/api/staff/transactions',"), source.indexOf("app.post('/api/staff/beer-gift',"));
const hook = source.slice(source.indexOf('async function halloweenAfterPurchase('), source.indexOf('async function halloweenAfterCancel('));
for (const mode of ['accrue', 'redeem']) test(`manual ${mode}: 1001 rub earns a ticket even when achievement sync fails; replay does not double credit`, async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE users(id BIGSERIAL PRIMARY KEY,telegram_id TEXT,first_name TEXT,last_name TEXT,qr_short_code TEXT,
      role TEXT,unlimited_bonus BOOLEAN,merged_into_user_id BIGINT,created_at TIMESTAMPTZ DEFAULT NOW(),deleted_at TIMESTAMPTZ);
      CREATE TABLE wallets(user_id BIGINT PRIMARY KEY REFERENCES users(id),balance BIGINT,updated_at TIMESTAMPTZ);
      CREATE TABLE beer_loyalty(user_id BIGINT PRIMARY KEY,paid_ml_total BIGINT DEFAULT 0,gift_ml_balance BIGINT DEFAULT 0,updated_at TIMESTAMPTZ);
      CREATE TABLE transactions(id BIGSERIAL PRIMARY KEY,request_key TEXT UNIQUE,client_id BIGINT REFERENCES users(id),staff_id BIGINT,
        mode TEXT,status TEXT,check_amount_cents BIGINT DEFAULT 0,discount_cents BIGINT,bonus_spent BIGINT,bonus_earned BIGINT,
        cash_paid_cents BIGINT,balance_after BIGINT,is_suspicious BOOLEAN,beer_ml BIGINT,beer_gift_earned_ml BIGINT,
        reason TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),completed_at TIMESTAMPTZ);
      INSERT INTO users(id,role,unlimited_bonus) VALUES(1,'client',FALSE);
      INSERT INTO wallets VALUES(1,100,NOW()); INSERT INTO beer_loyalty(user_id) VALUES(1);`);
    await db.exec(await readFile(new URL('../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
    const calls = [];
    const connection = { query: async (sql, params) => {
      calls.push(sql.trim()); const result = await db.query(sql, params);
      return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
    }, release() {} };
    const pool = { connect: async () => connection, query: connection.query };
    let handler;
    const warnings = [];
    vm.runInNewContext(hook + route, {
      app: { post: (_path, ...handlers) => { handler = handlers.at(-1); } },
      authRequired() {}, requireRole: () => () => {}, pool, recordHalloweenPurchase: recordPurchase, runHalloweenHook,
      centsFromInput: (value) => Math.round(Number(value) * 100), mlFromLiters: (value) => Math.round(Number(value) * 1000),
      normalizeRequestKey: String, resolveActingStaff: async () => ({ id: 2, firstName: 'Fixture' }),
      lockRequestKey: async () => {}, resolvePersonalQrRecord: async () => ({ id: 1 }),
      assertMatchingTransaction: (tx, expected) => { assert.equal(Number(tx.client_id), expected.clientId); assert.equal(tx.mode, expected.mode); },
      hasUnlimitedBonus: () => false, UNLIMITED_BONUS_BALANCE: 1000000,
      BEER_PAID_TARGET_ML: 10000, BEER_GIFT_ML: 1000, getRollingSpend: async () => 0,
      getEffectiveStatus: () => ({ discountPercent: 5, bonusPercent: 5 }), SUSPICIOUS_THRESHOLD_CENTS: 300000,
      createStaffTransactionPersistence, syncUserAchievements: async () => { throw Object.assign(new Error('fixture failure'), { code: 'FIXTURE_SYNC' }); },
      console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
      transactionResponse: (row) => row, getProfile: async () => ({ balance: Number((await db.query('SELECT balance FROM wallets')).rows[0].balance) }),
      sendTelegramMessage: async () => {}, ownerTelegramId: null, rubles: (cents) => cents / 100,
      litersFromMl: (ml) => ml / 1000
    });
    const req = { body: { mode, amount: 1001, beerLiters: 0, qrToken: 'fixture', requestKey: `fixture-${mode}`, bonusToSpend: 30 } };
    for (let i = 0; i < 2; i++) {
      let response;
      await handler(req, { json: (value) => { response = value; }, status: (code) => { assert.fail('unexpected status ' + code); } }, (error) => { throw error; });
      assert.equal(Number(response.transaction.check_amount_cents), 100100);
      assert.equal((await db.query('SELECT balance FROM halloween_ticket_balance WHERE user_id=1')).rows[0].balance, 1);
    }
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM transactions')).rows[0].n, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM halloween_ticket_ledger')).rows[0].n, 1);
    assert.equal(warnings.length, 2);
    assert.deepEqual(await auditBalances(db), []);
    assert.ok(calls.indexOf('COMMIT') < calls.findIndex((sql) => sql.includes('halloween_draw')));
  } finally { await db.close(); }
});
