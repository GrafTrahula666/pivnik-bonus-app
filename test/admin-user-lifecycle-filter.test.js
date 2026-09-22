import assert from 'node:assert/strict';
import test from 'node:test';
import { adminUserLifecycle, normalizeAdminUserDirectoryInput, queryAdminUserDirectory } from '../admin-user-directory.js';

test('admin lifecycle uses the same 30/60 day CRM boundaries as Customer 360', () => {
  const now = Date.parse('2026-09-22T00:00:00Z');
  const ago = (days) => new Date(now - days * 86_400_000).toISOString();
  assert.equal(adminUserLifecycle({ created_at: ago(5), sales_visits: 0 }, now), 'new');
  assert.equal(adminUserLifecycle({ created_at: ago(90), sales_visits: 0 }, now), 'no_visits');
  assert.equal(adminUserLifecycle({ created_at: ago(100), sales_visits: 2, last_visit_at: ago(10) }, now), 'active');
  assert.equal(adminUserLifecycle({ created_at: ago(100), sales_visits: 2, last_visit_at: ago(45) }, now), 'at_risk');
  assert.equal(adminUserLifecycle({ created_at: ago(100), sales_visits: 2, last_visit_at: ago(61) }, now), 'sleeping');
});

test('admin lifecycle filter is allow-listed and does not change the legacy default contract', () => {
  assert.deepEqual(normalizeAdminUserDirectoryInput({}), { q: '', role: '', status: '', page: 1, limit: 200 });
  assert.equal(normalizeAdminUserDirectoryInput({ lifecycle: 'at_risk' }).lifecycle, 'at_risk');
  assert.equal(normalizeAdminUserDirectoryInput({ lifecycle: 'DROP TABLE users' }).lifecycle, '');
});

test('admin lifecycle filtering is server-side and counts only completed accrue/redeem visits', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    }
  };
  const result = await queryAdminUserDirectory(pool, { lifecycle: 'at_risk', limit: '25' });
  assert.equal(result.filters.lifecycle, 'at_risk');
  assert.match(calls[0].sql, /t\.mode IN \('accrue','redeem'\)/);
  assert.match(calls[0].sql, /activity\.last_visit_at < NOW\(\) - INTERVAL '30 days'/);
  assert.match(calls[0].sql, /activity\.last_visit_at >= NOW\(\) - INTERVAL '60 days'/);
  assert.doesNotMatch(calls[0].sql, /DROP TABLE/);
});
