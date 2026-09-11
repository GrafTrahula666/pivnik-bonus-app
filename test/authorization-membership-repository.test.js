import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSqlMembershipRepository,
  membershipRepositoryContract
} from '../authorization-membership-repository.js';

test('membership repository performs one parameterized read-only SELECT', async () => {
  const calls = [];
  const loadMemberships = createSqlMembershipRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          { membership_role: 'owner', tenant_id: 'tenant-a', location_id: null },
          { membership_role: 'staff', tenant_id: 'tenant-b', location_id: 'loc-1' }
        ]
      };
    }
  });

  const rows = await loadMemberships(' 42 ');

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['42']);
  assert.match(calls[0].sql, /^\s*SELECT\b/i);
  assert.match(calls[0].sql, /FROM\s+spaceverse_memberships\b/i);
  assert.match(calls[0].sql, /user_id\s*=\s*\$1/i);
  assert.match(calls[0].sql, /revoked_at\s+IS\s+NULL/i);
  assert.doesNotMatch(calls[0].sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
  assert.deepEqual(rows, [
    { membership_role: 'owner', tenant_id: 'tenant-a', location_id: null },
    { membership_role: 'staff', tenant_id: 'tenant-b', location_id: 'loc-1' }
  ]);
  assert.equal(Object.isFrozen(rows[0]), true);
});

test('membership repository rejects missing identity before querying', async () => {
  let queried = false;
  const loadMemberships = createSqlMembershipRepository({
    async query() {
      queried = true;
      return { rows: [] };
    }
  });

  await assert.rejects(loadMemberships(null), /userId is required/);
  await assert.rejects(loadMemberships('   '), /userId must be a non-empty identifier/);
  assert.equal(queried, false);
});

test('membership repository fails closed on malformed database responses', async () => {
  const loadMemberships = createSqlMembershipRepository({
    async query() {
      return { rowCount: 0 };
    }
  });

  await assert.rejects(loadMemberships('7'), /rows\[\]/);
});

test('membership repository requires an injected query function', () => {
  assert.throws(() => createSqlMembershipRepository({}), /query must be a function/);
});

test('schema contract is explicit and contains no production write operation', () => {
  assert.equal(membershipRepositoryContract.table, 'spaceverse_memberships');
  assert.deepEqual(membershipRepositoryContract.requiredColumns, [
    'user_id',
    'tenant_id',
    'location_id',
    'role',
    'revoked_at'
  ]);
  assert.doesNotMatch(
    membershipRepositoryContract.selectSql,
    /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i
  );
});
