import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomer360Repository } from '../customer-360-repository.js';

test('Customer 360 rejects non-positive and malformed user identifiers before querying storage', async () => {
  let queryCalls = 0;
  const loadCustomer360 = createCustomer360Repository({
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    }
  });

  for (const value of [0, '0', -1, '-1', '', '  ', '1.5', 'abc']) {
    await assert.rejects(() => loadCustomer360(value), /positive integer identifier/);
  }
  assert.equal(queryCalls, 0, 'invalid identifiers must never reach PostgreSQL');
});
