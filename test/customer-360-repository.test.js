import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createCustomer360Repository } from '../customer-360-repository.js';

test('Customer 360 derives visits, LTV and average check only from completed sales', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGINT PRIMARY KEY, telegram_id BIGINT, username TEXT,
        first_name TEXT, last_name TEXT, role TEXT, created_at TIMESTAMPTZ,
        qr_short_code TEXT, marketing_opt_in BOOLEAN DEFAULT FALSE,
        merged_into_user_id BIGINT, deleted_at TIMESTAMPTZ
      );
      CREATE TABLE wallets (user_id BIGINT PRIMARY KEY, balance BIGINT);
      CREATE TABLE beer_loyalty (user_id BIGINT PRIMARY KEY, paid_ml_total BIGINT, gift_ml_balance BIGINT);
      CREATE TABLE transactions (
        id BIGSERIAL PRIMARY KEY, client_id BIGINT, staff_id BIGINT,
        mode TEXT, status TEXT, check_amount_cents BIGINT DEFAULT 0,
        cash_paid_cents BIGINT DEFAULT 0, bonus_earned BIGINT DEFAULT 0,
        bonus_spent BIGINT DEFAULT 0, balance_after BIGINT, reason TEXT,
        is_suspicious BOOLEAN DEFAULT FALSE, cancelled_at TIMESTAMPTZ,
        cancel_reason TEXT, created_at TIMESTAMPTZ
      );

      INSERT INTO users VALUES
        (1,101,'alice','Алиса','Тест','client',NOW()-INTERVAL '60 days','PVK-A',TRUE,NULL,NULL),
        (2,202,'staff','Анна','Бармен','staff',NOW()-INTERVAL '300 days','PVK-S',FALSE,NULL,NULL),
        (3,303,'deleted','Удалён','Клиент','client',NOW()-INTERVAL '60 days','PVK-D',FALSE,NULL,NOW());
      INSERT INTO wallets VALUES (1,350),(2,0),(3,0);
      INSERT INTO beer_loyalty VALUES (1,4500,1000);

      INSERT INTO transactions
        (client_id,staff_id,mode,status,check_amount_cents,cash_paid_cents,bonus_earned,bonus_spent,balance_after,reason,is_suspicious,cancelled_at,cancel_reason,created_at)
      VALUES
        (1,2,'accrue','completed',100000,100000,50,0,150,NULL,FALSE,NULL,NULL,NOW()-INTERVAL '40 days'),
        (1,2,'redeem','completed',200000,190000,80,10,220,NULL,FALSE,NULL,NULL,NOW()-INTERVAL '5 days'),
        (1,2,'accrue','cancelled',900000,900000,500,0,720,NULL,TRUE,NOW()-INTERVAL '1 day','ошибка',NOW()-INTERVAL '1 day'),
        (1,2,'adjustment','completed',0,0,130,0,350,'ручная корректировка',FALSE,NULL,NULL,NOW()-INTERVAL '2 days');
    `);

    const loadCustomer360 = createCustomer360Repository({ query: db.query.bind(db) });
    const customer = await loadCustomer360('1');

    assert.equal(customer.name, 'Алиса Тест');
    assert.equal(customer.balance, 350);
    assert.equal(customer.marketingOptIn, true);
    assert.equal(customer.metrics.visits, 2);
    assert.equal(customer.metrics.visits30d, 1);
    assert.equal(customer.metrics.lifetimeCheckCents, 300000);
    assert.equal(customer.metrics.averageCheckCents, 150000);
    assert.equal(customer.metrics.spend30dCents, 200000);
    assert.equal(customer.metrics.bonusEarned, 260, 'completed adjustment remains in bonus audit totals');
    assert.equal(customer.metrics.bonusSpent, 10);
    assert.ok(customer.metrics.frequency30d >= 0.9 && customer.metrics.frequency30d <= 1.1);
    assert.equal(customer.history.length, 4, 'history preserves cancelled and adjustment audit events');
    assert.equal(customer.history[0].status, 'cancelled');
    assert.equal(customer.history[0].staff_name, 'Анна Бармен');

    assert.equal(await loadCustomer360('3'), null, 'deleted customer is not exposed');
    await assert.rejects(() => loadCustomer360('not-an-id'), /userId/);
  } finally {
    await db.close();
  }
});

test('Customer 360 clamps history limit and returns null for unknown customer', async () => {
  const calls = [];
  const loadCustomer360 = createCustomer360Repository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === 1) return { rows: [{
        id: 7, telegram_id: null, username: null, first_name: 'Гость', last_name: null,
        role: 'client', created_at: new Date().toISOString(), qr_short_code: null,
        marketing_opt_in: false, balance: 0, paid_ml_total: 0, gift_ml_balance: 0,
        visits: 0, visits_30d: 0, last_visit_at: null, lifetime_check_cents: 0,
        average_check_cents: 0, spend_30d_cents: 0, bonus_earned: 0, bonus_spent: 0
      }] };
      return { rows: [] };
    }
  });
  await loadCustomer360(7, { historyLimit: 999 });
  assert.deepEqual(calls[1].params, ['7', 100]);

  const missing = createCustomer360Repository({ query: async () => ({ rows: [] }) });
  assert.equal(await missing(999), null);
});
