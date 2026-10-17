import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPosHttp } from '../pos/http.js';
import { createPosDeviceService } from '../pos/devices.js';
import { processPosRedemptions } from '../pos/redemption.js';
import { processPosBonuses } from '../pos/bonus.js';
import { importEvotorPage } from '../pos/repository.js';
import { normalizeEvotorDocument } from '../pos/evotor-document.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';
import { sale } from './fixtures/evotor.js';

const config = { enabled: true, bonusEnabled: true, redemptionEnabled: true, storeId: 'bar' };
const policy = { isUnlimited: row => Boolean(row.unlimited_bonus), unlimitedBalance: 9_999_999_999_999,
  status: async () => ({ bonusPercent: 5 }), suspiciousThresholdCents: 300_000, afterCommit: async () => {} };
const denied = status => error => error.statusCode === status;
const receipt = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

async function fixture() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./fixtures/evotor-redemption.sql', import.meta.url), 'utf8'));
  for (const name of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql','014_evotor_bonus_accrual.sql','023_evotor_redemptions.sql']) {
    await db.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  await db.exec("INSERT INTO pos_store_bindings VALUES('bar','tenant','location',TRUE),('other','other','other',TRUE)");
  await db.exec("INSERT INTO pos_operator_access VALUES(3,'bar',TRUE,NULL),(3,'other',TRUE,NULL)");
  const pool = { query: db.query.bind(db), connect: async () => ({ query: db.query.bind(db), release() {} }) };
  const devices = createPosDeviceService(pool, config, policy);
  const owner = { id: '3', role: 'admin', termsAccepted: true };
  const issued = await devices.issue(owner, { storeId: 'bar', externalDeviceId: 'one', label: 'one' });
  const other = await devices.issue(owner, { storeId: 'other', externalDeviceId: 'two', label: 'two' });
  const second = await devices.issue(owner, { storeId: 'bar', externalDeviceId: 'three', label: 'three' });
  const auth = 'Device ' + issued.deviceToken;
  const http = createPosHttp(pool, config, Date.now, policy);
  const request = (body, authorization = auth, h = http) => h.device({ method: 'POST', pathname: '/api/device/pos/redemptions', authorization, body });
  const compatible = body => http.device({ method:'POST',pathname:'/api/device/pos/receipts/bind',authorization:auth,
    body:{...body,operation:'redemption'} });
  const bind = (r = receipt, qr = 'PVK-AAAA-2222') => devices.bind(auth, { receiptUuid: r, payload: qr });
  const balance = async () => Number((await db.query('SELECT balance FROM wallets WHERE user_id=1')).rows[0].balance);
  const reserveBody = (extra = {}) => ({ action: 'reserve', receiptUuid: receipt, clientId: '1', totalCents: 100000,
    basketHash: 'a'.repeat(64), points: 300, operationId: randomUUID(), ...extra });
  const importDoc = doc => importEvotorPage(db, doc.store_id, { items: [doc], paging: {} }, { until: new Date().toISOString() });
  const process = () => processPosRedemptions(pool, { storeId: 'bar', policy });
  return { db,pool,devices,http,auth,request,compatible,bind,balance,reserveBody,importDoc,process,
    otherAuth: 'Device '+other.deviceToken, secondAuth: 'Device '+second.deviceToken, close: () => db.close() };
}

function closed(body, net = 700, extra = {}) {
  return sale({ id: body.receiptUuid, close_date: new Date(Date.now() + 60000).toISOString(),
    extras: { pivnikLoyaltyV1: { version: 1, operationId: body.operationId, points: body.points }, secret: 'not-retained' },
    body: { result_sum: net, positions: [{ product_name: 'Beer', quantity: 1, result_sum: net }],
      payments: [{ payment: { type: 'CASH', sum: net } }], doc_discounts: [{ doc_discount: { discount_type: 'SUM', discount_sum: body.points } }],
      pos_print_results: [{ pos_print_result: { receipt_number: 1 } }] }, ...extra });
}

test('redemption migration is repeatable/manual; new money capability is default off', async () => {
  const f = await fixture();
  try {
    await f.db.exec(await readFile(new URL('../migrations/023_evotor_redemptions.sql', import.meta.url), 'utf8'));
    assert.equal(isAutomaticStartupMigration('023_evotor_redemptions.sql'), false);
    await f.bind();
    const off = createPosHttp(f.pool, { ...config, redemptionEnabled: false }, Date.now, policy);
    await assert.rejects(f.request(f.reserveBody(), f.auth, off), denied(503));
    assert.equal(await f.balance(), 1000);
  } finally { await f.close(); }
});

test('requires live device/store/receipt claim; enforces 30% and available points; quote is read-only', async () => {
  const f = await fixture();
  try {
    const body = f.reserveBody();
    await assert.rejects(f.request(body, 'Device pvpos_'+'Z'.repeat(43)), denied(401));
    await assert.rejects(f.request(body), denied(409));
    await f.bind();
    await assert.rejects(f.request(body, f.otherAuth), denied(409));
    await assert.rejects(f.request(body, f.secondAuth), denied(409));
    await assert.rejects(f.request({ ...body, clientId: '2' }), denied(409));
    await assert.rejects(f.request({ ...body, points: 301 }), denied(409));
    await assert.rejects(f.request({ ...body, points: 0.1 }), denied(400));
    await assert.rejects(f.request({ ...body, totalCents: 1e20 }), denied(400));
    const quote = await f.request({ ...body, action: 'quote' });
    assert.equal(quote.maxPoints, 300);
    assert.equal(quote.balance, 1000);
    assert.equal(await f.balance(), 1000);
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n, 0);
    await f.db.query('UPDATE wallets SET balance=5 WHERE user_id=1');
    await assert.rejects(f.request(body), denied(409));
  } finally { await f.close(); }
});

test('reserve debits available funds once; lost response retries and cancellation are idempotent', async () => {
  const f = await fixture();
  try {
    await f.bind();
    const body = f.reserveBody();
    const first = await f.request(body);
    assert.equal(first.redemption.state, 'reserved');
    assert.equal(await f.balance(), 700);
    assert.deepEqual(await f.request(body), first);
    await assert.rejects(f.request({ ...body, points: 250 }), denied(409));
    await assert.rejects(f.request(f.reserveBody()), denied(409));
    await assert.rejects(f.bind(receipt, 'PVK-BBBB-3333'), denied(409));
    // A subsequent ordinary wallet writer can spend only the remaining 700.
    assert.equal((await f.db.query('UPDATE wallets SET balance=balance-701 WHERE user_id=1 AND balance>=701 RETURNING balance')).rows.length, 0);
    const cancel = { action: 'cancel', receiptUuid: receipt, operationId: body.operationId };
    await assert.rejects(f.request(cancel), denied(409));
    const off = createPosHttp(f.pool, { ...config, redemptionEnabled: false }, Date.now, policy);
    assert.equal((await f.request({ ...cancel, effectRemoved: true }, f.auth, off)).redemption.state, 'released');
    assert.equal(await f.balance(), 1000);
    await f.request({ ...cancel, effectRemoved: true });
    assert.equal(await f.balance(), 1000);
    await assert.rejects(f.request(body), denied(409));
    await f.request(f.reserveBody({ points: 100 }));
    assert.equal(await f.balance(), 900);
    const tx = (await f.db.query('SELECT * FROM transactions')).rows;
    assert.equal(tx.length, 3);
    assert.ok(tx.every(row => row.mode === 'adjustment' && Number(row.cash_paid_cents) === 0 && Number(row.check_amount_cents) === 0));
  } finally { await f.close(); }
});

test('only matching closed cloud marker/effect commits; cashback uses actual paid remainder', async () => {
  const f = await fixture();
  try {
    await f.bind();
    const body = f.reserveBody();
    await f.request(body);
    assert.deepEqual(await f.process(), []);
    const doc = closed(body);
    const normalized = normalizeEvotorDocument(doc, 'bar');
    assert.deepEqual(normalized.pivnikRedemption, { operationId: body.operationId, points: 300, documentDiscountCents: 30000 });
    assert.equal(JSON.stringify(normalized).includes('not-retained'), false);
    await f.importDoc(doc);
    assert.deepEqual(await f.process(), [{ documentId: receipt, state: 'committed' }]);
    assert.equal(await f.balance(), 700);
    await assert.rejects(f.request({ action: 'cancel', receiptUuid: receipt, operationId: body.operationId, effectRemoved: true }), denied(409));
    await f.importDoc(doc);
    assert.deepEqual(await f.process(), []);
    const accrual = await processPosBonuses(f.pool, { storeId: 'bar', ledger: policy });
    assert.equal(accrual[0].bonus, 35);
    assert.equal(accrual[0].amountCents, 70000);
    assert.equal(await f.balance(), 735);
    assert.deepEqual(await processPosBonuses(f.pool, { storeId: 'bar', ledger: policy }), []);
  } finally { await f.close(); }
});

test('cancellation arriving before a delayed reserve leaves a durable no-debit tombstone', async () => {
  const f=await fixture();
  try {
    await f.bind(); const body=f.reserveBody();
    const cancel={ action:'cancel',receiptUuid:receipt,operationId:body.operationId,effectRemoved:true };
    assert.deepEqual(await f.request(cancel),{ redemption:null,cancelledOperationId:body.operationId });
    await assert.rejects(f.request(body),denied(409));
    assert.deepEqual(await f.request(cancel),{ redemption:null,cancelledOperationId:body.operationId });
    assert.equal(await f.balance(),1000);
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM transactions')).rows[0].n,0);
  } finally { await f.close(); }
});

test('installed receipt-route masks support the same authenticated idempotent financial operation', async () => {
  const f=await fixture();
  try {
    await f.bind();const body=f.reserveBody();
    const first=await f.compatible(body);
    assert.deepEqual(await f.request(body),first);
    assert.equal(await f.balance(),700);
    const cancelled=await f.compatible({action:'cancel',receiptUuid:receipt,operationId:body.operationId,effectRemoved:true});
    assert.equal(cancelled.redemption.state,'released');
    assert.equal(await f.balance(),1000);
  } finally {await f.close();}
});

test('a fresh repeat scan can redeem a long open receipt without moving its original after-close claim time',async()=>{
  const f=await fixture();
  try {
    await f.bind();
    await f.db.exec("UPDATE pos_receipt_claims SET claimed_at='2020-01-01T00:00:00Z',updated_at='2020-01-01T00:00:00Z'");
    const body=f.reserveBody();await assert.rejects(f.request(body),denied(409));
    await f.bind();
    assert.equal((await f.db.query('SELECT claimed_at FROM pos_receipt_claims')).rows[0].claimed_at.toISOString(),'2020-01-01T00:00:00.000Z');
    assert.equal((await f.request(body)).redemption.state,'reserved');
    assert.equal(await f.balance(),700);
  }finally{await f.close();}
});

test('mismatched, unknown and missing receipt effect hold for review, never refund a paid discount', async () => {
  const f = await fixture();
  try {
    for (const [i, mutate] of [doc => delete doc.extras, doc => doc.extras.pivnikLoyaltyV1.operationId=randomUUID(),
      doc => doc.body.doc_discounts=[], doc => doc.body.result_sum=600, doc => delete doc.body.doc_discounts].entries()) {
      const r = 'case-'+i;
      await f.bind(r);
      const body = f.reserveBody({ receiptUuid: r, points: 10 });
      await f.request(body);
      const doc = closed(body, 990); mutate(doc);
      await f.importDoc(doc);
      const result = await f.process();
      assert.equal(result[0].state, i === 2 ? 'released' : 'review');
    }
    assert.equal(await f.balance(), 960);
    assert.deepEqual(await f.process(), []);
  } finally { await f.close(); }
});

test('partial then full refund restores spent points cumulatively once, including zero cashback', async () => {
  const f = await fixture();
  try {
    await f.bind();
    const body = f.reserveBody(); await f.request(body); await f.importDoc(closed(body)); await f.process();
    const back = (id, net) => sale({ id, type: 'PAYBACK', close_date: new Date().toISOString(), body: {
      base_document_id: receipt, result_sum: net, positions: [], payments: [], doc_discounts: [] } });
    await f.importDoc(back('return-a', 100)); await f.process();
    assert.equal(await f.balance(), 742); // floor(300*100/700)
    await f.importDoc(back('return-b', 100)); await f.process();
    assert.equal(await f.balance(), 785); // cumulative floor(600/7), not twice floor(300/7)
    await f.importDoc(back('return-full', 700)); await f.process();
    assert.equal(await f.balance(), 1000);
    await f.importDoc(back('return-extra', 700)); await f.process();
    assert.equal(await f.balance(), 1000);
    assert.deepEqual(await f.process(), []);
    assert.equal(Number((await f.db.query('SELECT SUM(points) AS n FROM pos_redemption_refunds')).rows[0].n), 300);
  } finally { await f.close(); }
});

test('unlimited policy is injected, never inferred from QR and never mints a finite wallet on refund', async () => {
  const f = await fixture();
  try {
    await f.db.exec('UPDATE users SET unlimited_bonus=TRUE WHERE id=1');
    await f.bind(); const body=f.reserveBody(); await f.request(body);
    assert.equal(await f.balance(), 1000);
    await f.importDoc(closed(body)); await f.process();
    await f.importDoc(sale({ id: 'owner-refund', type: 'PAYBACK', body: { base_document_id: receipt, result_sum: 700, positions: [], payments: [] } }));
    await f.process();
    assert.equal(await f.balance(), 1000);
  } finally { await f.close(); }
});
