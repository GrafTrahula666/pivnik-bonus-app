import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

async function loadAdminSummarySql() {
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const routeStart = server.indexOf("app.get('/api/admin/summary'");
  assert.notEqual(routeStart, -1, 'admin summary route must exist');
  const queryMarker = 'const summaryResult = await pool.query(`';
  const queryStart = server.indexOf(queryMarker, routeStart);
  assert.notEqual(queryStart, -1, 'admin summary SQL must exist');
  const sqlStart = queryStart + queryMarker.length;
  const sqlEnd = server.indexOf('`);', sqlStart);
  assert.notEqual(sqlEnd, -1, 'admin summary SQL must terminate');
  return server.slice(sqlStart, sqlEnd);
}

test('optimized admin summary SQL preserves KPI and period semantics on PostgreSQL aggregates', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (id BIGINT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, merged_into_user_id BIGINT, deleted_at TIMESTAMPTZ);
      CREATE TABLE transactions (
        id BIGSERIAL PRIMARY KEY, client_id BIGINT, status TEXT NOT NULL,
        bonus_earned BIGINT NOT NULL DEFAULT 0, bonus_spent BIGINT NOT NULL DEFAULT 0,
        check_amount_cents BIGINT NOT NULL DEFAULT 0, is_suspicious BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL, cancelled_at TIMESTAMPTZ
      );
      INSERT INTO users (id, created_at, merged_into_user_id, deleted_at) VALUES
        (1, NOW() - INTERVAL '2 days', NULL, NULL),
        (2, NOW() - INTERVAL '80 days', NULL, NULL),
        (3, NOW() - INTERVAL '120 days', NULL, NULL),
        (4, NOW() - INTERVAL '100 days', NULL, NULL),
        (5, NOW() - INTERVAL '1 day', 2, NULL),
        (6, NOW() - INTERVAL '1 day', NULL, NOW());
      INSERT INTO transactions (client_id, status, bonus_earned, bonus_spent, check_amount_cents, is_suspicious, created_at, cancelled_at) VALUES
        (2, 'completed', 10, 2, 1000, TRUE, CURRENT_DATE + INTERVAL '1 hour', NULL),
        (3, 'completed', 50, 5, 5000, FALSE, NOW() - INTERVAL '45 days', NULL),
        (4, 'cancelled', 999, 999, 999, FALSE, CURRENT_DATE + INTERVAL '2 hours', CURRENT_DATE + INTERVAL '2 hours'),
        (5, 'completed', 20, 1, 2000, FALSE, CURRENT_DATE - INTERVAL '1 day' + INTERVAL '3 hours', NULL),
        (6, 'completed', 30, 3, 3000, FALSE, CURRENT_DATE + INTERVAL '4 hours', NULL);
    `);
    const result = await db.query(await loadAdminSummarySql());
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];
    assert.deepEqual({
      clients: Number(row.clients), newClients7d: Number(row.new_clients_7d),
      activeClients30d: Number(row.active_clients_30d), inactiveClients30d: Number(row.inactive_clients_30d),
      issued: Number(row.issued), redeemed: Number(row.redeemed), todayOps: Number(row.today_ops),
      todayCompletedOps: Number(row.today_completed_ops), yesterdayCompletedOps: Number(row.yesterday_completed_ops),
      todayCheckCents: Number(row.today_check_cents), yesterdayCheckCents: Number(row.yesterday_check_cents),
      lifetimeCheckCents: Number(row.lifetime_check_cents), suspiciousOps: Number(row.suspicious_ops),
      cancelledToday: Number(row.cancelled_today)
    }, {
      clients: 4, newClients7d: 1, activeClients30d: 1, inactiveClients30d: 1,
      issued: 110, redeemed: 11, todayOps: 3, todayCompletedOps: 2, yesterdayCompletedOps: 1,
      todayCheckCents: 4000, yesterdayCheckCents: 2000, lifetimeCheckCents: 11000,
      suspiciousOps: 1, cancelledToday: 1
    });
  } finally {
    await db.close();
  }
});
