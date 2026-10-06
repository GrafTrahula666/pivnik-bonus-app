import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { normalizeEvotorDocument, scaledInteger, moscowPeriod } from '../pos/evotor-document.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';

import { sale } from './fixtures/evotor.js';
test('anonymous sale has exact cents, fractional quantity and no inferred profile', () => {
  const result = normalizeEvotorDocument(sale(), 'bar');
  assert.equal(result.amountCents, 30);
  assert.equal(result.positions[0].quantityMillis, 500);
  assert.equal(result.linkable, true);
  assert.equal(result.clientId, undefined);
  assert.equal(scaledInteger('100.01'), 10001);
  assert.throws(() => scaledInteger(0.1 + 0.2));
});
test('only closed SELL/PAYBACK, rejects missing date, cross-store and incomplete money', () => {
  assert.equal(normalizeEvotorDocument(sale({ type: 'OPEN_SESSION' }), 'bar'), null);
  assert.equal(normalizeEvotorDocument(sale({ type: 'PAYBACK' }), 'bar').type, 'PAYBACK');
  assert.throws(() => normalizeEvotorDocument(sale({ close_date: null }), 'bar'));
  assert.throws(() => normalizeEvotorDocument(sale(), 'another'));
  assert.throws(() => normalizeEvotorDocument(sale({ body: { positions: [], payments: [] } }), 'bar'));
});
test('split/unknown fiscal receipts cannot be attributed to one client', () => {
  const doc = sale(); doc.body.pos_print_results.push({ pos_print_result: { receipt_number: 8 } });
  assert.equal(normalizeEvotorDocument(doc, 'bar').linkable, false);
  doc.body.pos_print_results = [];
  assert.equal(normalizeEvotorDocument(doc, 'bar').receiptCount, null);
});
test('Moscow midnight and all period presets use inclusive days and exclusive upper bound', () => {
  const now = new Date('2026-10-01T21:00:00Z');
  assert.equal(moscowPeriod({}, now).start, '2026-10-02');
  assert.equal(moscowPeriod({ period: 'yesterday' }, now).end, '2026-10-01');
  assert.equal(moscowPeriod({ period: '7days' }, now).start, '2026-09-26');
  assert.equal(moscowPeriod({ period: 'month' }, now).start, '2026-10-01');
  assert.throws(() => moscowPeriod({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }));
});
test('additive migration is repeatable and is never an automatic startup migration', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE users (id BIGSERIAL PRIMARY KEY)');
    const sql = await readFile(new URL('../migrations/012_evotor_sales.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const scopeSql=await readFile(new URL('../migrations/013_evotor_pos_scope_devices.sql',import.meta.url),'utf8');
    await db.exec(scopeSql);await db.exec(scopeSql);
    assert.equal(isAutomaticStartupMigration('013_evotor_pos_scope_devices.sql'),false);
    assert.equal(isAutomaticStartupMigration('012_evotor_sales.sql'), false);
    assert.equal((await db.query("SELECT to_regclass('pos_documents') AS name")).rows[0].name, 'pos_documents');
  } finally { await db.close(); }
});
