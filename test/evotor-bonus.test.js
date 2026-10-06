import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPosHttp } from '../pos/http.js';
import { createPosDeviceService } from '../pos/devices.js';
import { importEvotorPage } from '../pos/repository.js';
import { processPosBonuses, posBonusConfig } from '../pos/bonus.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';
import { sale } from './fixtures/evotor.js';

const config = { enabled: true, token: 'fixture-provider-only', storeId: 'bar' };
const owner = { id: '3', role: 'admin', termsAccepted: true };
const denied = (status) => (error) => error.statusCode === status;
const RECEIPT = '0f8fad5b-d9cb-469f-a165-70867728950e';

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,telegram_id BIGINT,username TEXT,first_name TEXT,role TEXT DEFAULT 'client',
      unlimited_bonus BOOLEAN DEFAULT FALSE,qr_token TEXT,qr_short_code TEXT,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
    CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);
    CREATE TABLE wallets(user_id BIGINT PRIMARY KEY,balance BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ);
    CREATE TABLE transactions(id BIGSERIAL PRIMARY KEY,request_key TEXT UNIQUE,client_id BIGINT NOT NULL REFERENCES users(id),
      staff_id BIGINT REFERENCES users(id),mode TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'completed',
      check_amount_cents BIGINT NOT NULL DEFAULT 0,discount_cents BIGINT NOT NULL DEFAULT 0,bonus_spent BIGINT NOT NULL DEFAULT 0,
      bonus_earned BIGINT NOT NULL DEFAULT 0,cash_paid_cents BIGINT NOT NULL DEFAULT 0,balance_after BIGINT,reason TEXT,
      is_suspicious BOOLEAN NOT NULL DEFAULT FALSE,beer_ml INTEGER NOT NULL DEFAULT 0,beer_gift_earned_ml INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    INSERT INTO users(id,telegram_id,first_name,qr_short_code,unlimited_bonus) VALUES
      (1,101,'Client','PVK-AAAA-2222',FALSE),(2,102,'Other','PVK-BBBB-3333',FALSE),(3,NULL,'Admin',NULL,FALSE),(6,106,'Owner','PVK-EEEE-6666',TRUE);
    INSERT INTO wallets(user_id,balance) VALUES(1,100),(2,200),(6,0);`);
  for (const name of ['012_evotor_sales.sql', '013_evotor_pos_scope_devices.sql', '014_evotor_bonus_accrual.sql']) {
    await db.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  await db.exec(`INSERT INTO pos_store_bindings VALUES('bar','tenant-a','loc-a',TRUE),('other','tenant-b','loc-b',TRUE);
    INSERT INTO pos_operator_access VALUES(3,'bar',TRUE,NULL);`);
  const pool = { query: db.query.bind(db), connect: async () => ({ query: db.query.bind(db), release() {} }) };
  const devices = createPosDeviceService(pool, config);
  const issued = await devices.issue(owner, { storeId: 'bar', externalDeviceId: 'terminal-1', label: 'Till' });
  const notices = [];
  const ledger = {
    unlimitedBalance: 9_999_999_999_999,
    suspiciousThresholdCents: 300_000,
    isUnlimited: (row) => Boolean(row.unlimited_bonus),
    status: async () => ({ bonusPercent: 5 }),
    async cancel(tx, id, reason, key) {
      const row = (await tx.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [id])).rows[0];
      const wallet = (await tx.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [row.client_id])).rows[0];
      if (Number(wallet.balance) < Number(row.bonus_earned)) throw Object.assign(new Error('spent'), { statusCode: 409 });
      await tx.query('UPDATE wallets SET balance=balance-$1 WHERE user_id=$2', [row.bonus_earned, row.client_id]);
      return (await tx.query("UPDATE transactions SET status='cancelled',reason=$2 WHERE id=$1 RETURNING *", [id, reason + ' ' + key])).rows[0];
    },
    afterCommit: async (result) => { notices.push(result); }
  };
  const importDocs = (items) => importEvotorPage(db, 'bar', { items, paging: {} }, { until: '2026-10-07T00:00:00Z', cursor: null });
  return { db, pool, devices, auth: 'Device ' + issued.deviceToken, ledger, notices, importDocs, close: () => db.close() };
}

const balance = async (db, id) => Number((await db.query('SELECT balance FROM wallets WHERE user_id=$1', [id])).rows[0].balance);
const run = (f) => processPosBonuses(f.pool, { storeId: 'bar', ledger: f.ledger });
const sell = (id, rubles, closeDate = new Date(Date.now() + 60_000).toISOString()) => sale({ id, close_date: closeDate,
  body: { result_sum: rubles, positions: [{ product_name: 'Пиво', quantity: 1, result_sum: rubles }],
    payments: [{ payment: { type: 'CASH', sum: rubles } }], pos_print_results: [{ pos_print_result: { receipt_number: 7 } }] } });
const payback = (id, baseId, rubles) => sale({ id, type: 'PAYBACK', close_date: '2026-10-06T13:00:00.000+0000',
  body: { result_sum: rubles, base_document_id: baseId, positions: [{ product_name: 'Пиво', quantity: 1, result_sum: rubles }],
    payments: [{ payment: { type: 'CASH', sum: rubles } }], pos_print_results: [{ pos_print_result: { receipt_number: 8 } }] } });

test('migration 014 is additive, repeatable and never runs at startup', async () => {
  const f = await fixture();
  try {
    await f.db.exec(await readFile(new URL('../migrations/014_evotor_bonus_accrual.sql', import.meta.url), 'utf8'));
    assert.equal(isAutomaticStartupMigration('014_evotor_bonus_accrual.sql'), false);
    assert.deepEqual(posBonusConfig({}), { enabled: false, syncSeconds: 120 });
    assert.deepEqual(posBonusConfig({ PIVNIK_POS_BONUS_ENABLED: 'true', PIVNIK_POS_SYNC_SECONDS: '5' }), { enabled: true, syncSeconds: 30 });
  } finally { await f.close(); }
});

test('till bind records who was scanned into which receipt and never touches money', async (t) => {
  const f = await fixture();
  try {
    const http = createPosHttp(f.pool, config);
    const bind = (body, authorization = f.auth) => http.device({ method: 'POST', pathname: '/api/device/pos/receipts/bind', authorization, body, address: 'till' });
    await t.test('requires the device key, a receipt UUID and a live QR', async () => {
      await assert.rejects(bind({ receiptUuid: RECEIPT, payload: 'PVK-AAAA-2222' }, 'Device pvpos_' + 'A'.repeat(43)), denied(401));
      await assert.rejects(bind({ receiptUuid: 'bad uuid', payload: 'PVK-AAAA-2222' }), denied(400));
      await assert.rejects(bind({ receiptUuid: RECEIPT, payload: 'PVK-ZZZZ-0000' }), denied(404));
      await assert.rejects(http.device({ method: 'GET', pathname: '/api/device/pos/receipts/bind', authorization: f.auth, address: 'till' }), denied(404));
    });
    await t.test('latest bind wins until the receipt is settled', async () => {
      assert.deepEqual(await bind({ receiptUuid: RECEIPT, payload: 'PVK-AAAA-2222' }), { client: { id: '1', firstName: 'Client' } });
      await bind({ receiptUuid: RECEIPT, payload: 'PVK-BBBB-3333' });
      const claims = (await f.db.query('SELECT client_id FROM pos_receipt_claims')).rows;
      assert.deepEqual(claims.map((row) => String(row.client_id)), ['2']);
      assert.equal(await balance(f.db, 1), 100);
      assert.equal(await balance(f.db, 2), 200);
      assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n, 0);
    });
  } finally { await f.close(); }
});

test('a claimed closed sale accrues once, from the cloud amount, with the bar status rule', async () => {
  const f = await fixture();
  try {
    await f.devices.bind(f.auth, { receiptUuid: RECEIPT, payload: 'PVK-AAAA-2222' });
    await f.importDocs([sell(RECEIPT, 1234.5), sell('unclaimed-sale', 999)]);
    const first = await run(f);
    assert.equal(first.length, 1);
    assert.equal(first[0].status, 'applied');
    assert.equal(first[0].bonus, 61); // floor(123450 * 5 / 10000)
    assert.equal(await balance(f.db, 1), 161);
    const tx = (await f.db.query('SELECT * FROM transactions')).rows;
    assert.equal(tx.length, 1);
    assert.equal(tx[0].request_key, `evotor:bar:${RECEIPT}`);
    assert.equal(tx[0].mode, 'accrue');
    assert.equal(tx[0].staff_id, null);
    assert.equal(Number(tx[0].check_amount_cents), 123450);
    assert.equal(Number(tx[0].cash_paid_cents), 123450);
    assert.equal(Number(tx[0].discount_cents), 0);
    assert.deepEqual(await run(f), []);
    assert.equal(await balance(f.db, 1), 161);
    assert.equal(f.notices.length, 1);
    await assert.rejects(f.devices.bind(f.auth, { receiptUuid: RECEIPT, payload: 'PVK-BBBB-3333' }), denied(409));
    assert.deepEqual(await f.devices.bind(f.auth, { receiptUuid: RECEIPT, payload: 'PVK-AAAA-2222' }), { client: { id: '1', firstName: 'Client' } });
  } finally { await f.close(); }
});

test('a claim made long after the receipt closed is refused, unlimited balances stay unlimited', async () => {
  const f = await fixture();
  try {
    await f.devices.bind(f.auth, { receiptUuid: 'old-receipt', payload: 'PVK-AAAA-2222' });
    await f.devices.bind(f.auth, { receiptUuid: RECEIPT, payload: 'PVK-EEEE-6666' });
    await f.importDocs([sell('old-receipt', 500, '2026-01-01T12:00:00.000+0000'), sell(RECEIPT, 500)]);
    await f.db.query("UPDATE pos_receipt_claims SET claimed_at='2026-10-06T12:05:00Z'");
    const results = await run(f);
    const old = results.find((item) => item.documentId === 'old-receipt');
    assert.equal(old.status, 'skipped');
    assert.equal(old.reason, 'claim_after_close');
    assert.equal(await balance(f.db, 1), 100);
    assert.equal(results.find((item) => item.documentId === RECEIPT).status, 'applied');
    assert.equal(await balance(f.db, 6), 0);
  } finally { await f.close(); }
});

test('returns take back proportional bonus, a full return cancels the purchase, spent bonus is capped', async (t) => {
  const f = await fixture();
  try {
    await f.devices.bind(f.auth, { receiptUuid: 'sale-a', payload: 'PVK-AAAA-2222' });
    await f.devices.bind(f.auth, { receiptUuid: 'sale-b', payload: 'PVK-BBBB-3333' });
    await f.importDocs([sell('sale-a', 2000), sell('sale-b', 1000)]);
    await run(f);
    assert.equal(await balance(f.db, 1), 200);
    assert.equal(await balance(f.db, 2), 250);

    await t.test('partial return of a quarter removes a quarter of the bonus', async () => {
      await f.importDocs([payback('ret-a1', 'sale-a', 500)]);
      const [result] = await run(f);
      assert.equal(result.removed, 25);
      assert.equal(await balance(f.db, 1), 175);
    });
    await t.test('later returns never take back more than was earned', async () => {
      await f.importDocs([payback('ret-a2', 'sale-a', 2000)]);
      const [result] = await run(f);
      assert.equal(result.removed, 75);
      assert.equal(await balance(f.db, 1), 100);
      await f.importDocs([payback('ret-a3', 'sale-a', 100)]);
      const [nothing] = await run(f);
      assert.equal(nothing.reason, 'nothing_to_reverse');
    });
    await t.test('full return cancels the original accrual', async () => {
      await f.importDocs([payback('ret-b', 'sale-b', 1000)]);
      const [result] = await run(f);
      assert.ok(result.cancelledTransactionId);
      assert.equal(await balance(f.db, 2), 200);
      const original = (await f.db.query("SELECT status FROM transactions WHERE request_key='evotor:bar:sale-b'")).rows[0];
      assert.equal(original.status, 'cancelled');
    });
    await t.test('when the bonus was already spent only the remaining balance is taken', async () => {
      await f.devices.bind(f.auth, { receiptUuid: 'sale-c', payload: 'PVK-BBBB-3333' });
      await f.importDocs([sell('sale-c', 4000)]);
      await run(f);
      await f.db.query('UPDATE wallets SET balance=50 WHERE user_id=2');
      await f.importDocs([payback('ret-c', 'sale-c', 4000)]);
      const [result] = await run(f);
      assert.equal(result.removed, 50);
      assert.equal(result.shortfall, 150);
      assert.equal(await balance(f.db, 2), 0);
    });
    await t.test('a return of an unclaimed sale is ignored', async () => {
      await f.importDocs([sell('anon', 300), payback('ret-anon', 'anon', 300)]);
      assert.deepEqual(await run(f), []);
    });
  } finally { await f.close(); }
});
