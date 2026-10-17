import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import {
  createSpaceverseRuntimeManifest,
  resolveSpaceverseRuntime
} from '../spaceverse-runtime-manifest.js';
import {
  createSpaceverseTransactionPersistence,
  transactionPersistenceContract
} from '../transaction-persistence.js';

const bindingMigrationUrl = new URL('../migrations/017_spaceverse_runtime_binding.sql', import.meta.url);
const scopeMigrationUrl = new URL('../migrations/018_spaceverse_runtime_scope_binding.sql', import.meta.url);
const attributionMigrationUrl = new URL('../migrations/009_spaceverse_tenant_attribution.sql', import.meta.url);

function applicationConfig(name) {
  return {
    displayName: name,
    theme: 'dark',
    primaryColor: '#112233',
    secondaryColor: '#445566',
    shopEnabled: true,
    loyaltyEnabled: true
  };
}

function transaction(requestKey, overrides = {}) {
  return {
    request_key: requestKey,
    client_id: 11,
    staff_id: 21,
    mode: 'accrue',
    status: 'completed',
    bonus_earned: 25,
    reason: 'isolated runtime write',
    ...overrides
  };
}

async function tenantDatabase({ seed, companyId, venueId }) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE transactions (
      id BIGSERIAL PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      client_id BIGINT NOT NULL,
      staff_id BIGINT,
      mode TEXT NOT NULL,
      status TEXT,
      bonus_earned BIGINT,
      reason TEXT
    )
  `);
  await db.exec(await fs.readFile(attributionMigrationUrl, 'utf8'));
  await db.exec(await fs.readFile(attributionMigrationUrl, 'utf8'));
  await db.exec(await fs.readFile(bindingMigrationUrl, 'utf8'));
  await db.exec(await fs.readFile(scopeMigrationUrl, 'utf8'));

  const draftId = `${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${seed.repeat(12)}`;
  const runtimeKey = `sv-${seed.repeat(32)}`;
  const manifest = createSpaceverseRuntimeManifest({
    draftId,
    runtimeKey,
    draftRevision: 1,
    applicationRevision: 1,
    scopeRevision: 1,
    scope: { companyId, venueId },
    config: applicationConfig(`Venue ${venueId}`)
  });
  await db.query(
    `INSERT INTO spaceverse_runtime_binding(
       singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status
     ) VALUES(TRUE,$1,$2,$3,$4,$5,'dedicated_database','prepared')`,
    [runtimeKey, manifest.manifestSha256, 1, companyId, venueId]
  );
  const runtime = await resolveSpaceverseRuntime({
    environment: {
      SPACEVERSE_RUNTIME_MODE: 'tenant',
      SPACEVERSE_RUNTIME_MANIFEST_JSON: JSON.stringify(manifest)
    },
    query: db.query.bind(db)
  });
  return { db, runtime };
}

test('verified runtime write derives scope from the bound database and replays exactly once', async () => {
  const fixture = await tenantDatabase({ seed: '1', companyId: '700', venueId: '701' });
  const calls = [];
  try {
    const persist = createSpaceverseTransactionPersistence({
      runtime: fixture.runtime,
      query: async (sql, params) => {
        calls.push({ sql, params });
        return fixture.db.query(sql, params);
      }
    });
    const command = transaction('  venue-701-operation-1  ');
    const first = await persist({ transaction: command });
    const replay = await persist({ transaction: command });

    assert.equal(first.id, replay.id);
    assert.equal(first.request_key, 'venue-701-operation-1');
    assert.equal(first.tenant_id, '700');
    assert.equal(first.location_id, '701');
    assert.equal((await fixture.db.query('SELECT COUNT(*)::integer AS count FROM transactions')).rows[0].count, 1);
    assert.match(calls[0].sql, /FROM spaceverse_runtime_binding AS binding/i);
    assert.match(calls[0].sql, /ON CONFLICT \(request_key\) DO UPDATE/i);
    assert.match(calls[0].sql, /binding\.company_id[\s\S]*binding\.venue_id/i);
    assert.doesNotMatch(calls[0].sql, /venue-701-operation-1|\b700\b|\b701\b/);
    assert.equal(Object.isFrozen(first), true);
  } finally {
    await fixture.db.close();
  }
});

test('lost write response is reconciled by retrying the same request key', async () => {
  const fixture = await tenantDatabase({ seed: '2', companyId: '710', venueId: '711' });
  let loseFirstResponse = true;
  try {
    const persist = createSpaceverseTransactionPersistence({
      runtime: fixture.runtime,
      query: async (sql, params) => {
        const result = await fixture.db.query(sql, params);
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error('synthetic connection loss after commit');
        }
        return result;
      }
    });
    const command = transaction('venue-711-operation-1');

    await assert.rejects(
      persist({ transaction: command }),
      (error) => error?.code === 'SPACEVERSE_TRANSACTION_WRITE_UNAVAILABLE'
        && !String(error?.message).includes('synthetic connection loss')
    );
    const replay = await persist({ transaction: command });
    assert.equal(replay.request_key, command.request_key);
    assert.equal((await fixture.db.query('SELECT COUNT(*)::integer AS count FROM transactions')).rows[0].count, 1);
  } finally {
    await fixture.db.close();
  }
});

test('request scope and conflicting replay payload are rejected without another write', async () => {
  const fixture = await tenantDatabase({ seed: '3', companyId: '720', venueId: '721' });
  let queryCalls = 0;
  try {
    const persist = createSpaceverseTransactionPersistence({
      runtime: fixture.runtime,
      query: async (sql, params) => {
        queryCalls += 1;
        return fixture.db.query(sql, params);
      }
    });

    await assert.rejects(
      persist({ tenantId: 'attacker', locationId: 'another-venue', transaction: transaction('blocked') }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN'
    );
    await assert.rejects(
      persist({ transaction: { ...transaction('blocked-payload'), tenant_id: 'attacker' } }),
      /Unsupported transaction column: tenant_id/
    );
    assert.equal(queryCalls, 0);

    await persist({ transaction: transaction('same-key') });
    await assert.rejects(
      persist({ transaction: transaction('same-key', { bonus_earned: 26 }) }),
      (error) => error?.code === 'SPACEVERSE_TRANSACTION_WRITE_REJECTED'
    );
    assert.equal((await fixture.db.query('SELECT COUNT(*)::integer AS count FROM transactions')).rows[0].count, 1);
  } finally {
    await fixture.db.close();
  }
});

test('database binding blocks cross-tenant and cross-location writes for two venues in one company', async () => {
  const first = await tenantDatabase({ seed: '4', companyId: '800', venueId: '801' });
  const second = await tenantDatabase({ seed: '5', companyId: '800', venueId: '802' });
  const foreign = await tenantDatabase({ seed: '6', companyId: '900', venueId: '901' });
  try {
    const firstPersist = createSpaceverseTransactionPersistence({
      runtime: first.runtime,
      query: first.db.query.bind(first.db)
    });
    const secondPersist = createSpaceverseTransactionPersistence({
      runtime: second.runtime,
      query: second.db.query.bind(second.db)
    });
    await firstPersist({ transaction: transaction('venue-801') });
    await secondPersist({ transaction: transaction('venue-802') });

    for (const [runtime, targetDb, requestKey] of [
      [first.runtime, second.db, 'wrong-location'],
      [foreign.runtime, first.db, 'wrong-tenant']
    ]) {
      const crossPersist = createSpaceverseTransactionPersistence({
        runtime,
        query: targetDb.query.bind(targetDb)
      });
      await assert.rejects(
        crossPersist({ transaction: transaction(requestKey) }),
        (error) => error?.code === 'SPACEVERSE_TRANSACTION_WRITE_REJECTED'
      );
    }

    assert.deepEqual(
      (await first.db.query('SELECT request_key,tenant_id,location_id FROM transactions ORDER BY id')).rows,
      [{ request_key: 'venue-801', tenant_id: '800', location_id: '801' }]
    );
    assert.deepEqual(
      (await second.db.query('SELECT request_key,tenant_id,location_id FROM transactions ORDER BY id')).rows,
      [{ request_key: 'venue-802', tenant_id: '800', location_id: '802' }]
    );
  } finally {
    await first.db.close();
    await second.db.close();
    await foreign.db.close();
  }
});

test('runtime transaction boundary rejects forged runtime objects and never enables legacy fallback', async () => {
  let queries = 0;
  assert.throws(
    () => createSpaceverseTransactionPersistence({
      runtime: {
        mode: 'tenant',
        context: { tenantId: '700', locationId: '701' },
        binding: { runtimeKey: 'sv-forged' }
      },
      query: async () => { queries += 1; return { rows: [{}] }; }
    }),
    (error) => error?.code === 'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED'
  );
  assert.equal(queries, 0);
  assert.equal(transactionPersistenceContract.runtimeBindingRecheckedInWrite, true);
  assert.equal(transactionPersistenceContract.runtimeRequestScopeAccepted, false);
  assert.equal(transactionPersistenceContract.runtimeReplayKey, 'request_key');
  assert.equal(transactionPersistenceContract.runtimeFallbackToLegacy, false);
  assert.equal(transactionPersistenceContract.productionWiringEnabled, false);
});
