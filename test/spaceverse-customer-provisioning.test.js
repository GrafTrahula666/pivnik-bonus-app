import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import {
  createSpaceverseCustomerProvisioner,
  customerProvisioningContract
} from '../customer-provisioning.js';
import { createSpaceverseCustomerWalletRepository } from '../customer-wallet-repository.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';
import {
  createSpaceverseRuntimeManifest,
  resolveSpaceverseRuntime
} from '../spaceverse-runtime-manifest.js';

const migrationUrls = [17, 18, 19, 20].map((number) => new URL(
  `../migrations/${String(number).padStart(3, '0')}_${({
    17: 'spaceverse_runtime_binding',
    18: 'spaceverse_runtime_scope_binding',
    19: 'spaceverse_customer_ownership',
    20: 'spaceverse_customer_create_requests'
  })[number]}.sql`,
  import.meta.url
));
const createRequestMigrationUrl = migrationUrls[3];

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

async function createBaseSchema(db) {
  await db.exec(`
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE,
      username TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT,
      photo_url TEXT,
      role TEXT NOT NULL DEFAULT 'client',
      deleted_at TIMESTAMPTZ,
      merged_into_user_id BIGINT REFERENCES users(id)
    );
    CREATE TABLE user_identities (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('telegram','vk')),
      provider_user_id TEXT NOT NULL,
      provider_username TEXT,
      UNIQUE(provider,provider_user_id),
      UNIQUE(user_id,provider)
    );
    CREATE TABLE wallets (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function tenantDatabase({ seed, companyId, venueId }) {
  const db = new PGlite();
  await createBaseSchema(db);
  for (const migrationUrl of migrationUrls) {
    await db.exec(await fs.readFile(migrationUrl, 'utf8'));
  }

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
  return { db, runtime, manifest };
}

function connection(db, intercept) {
  return async () => ({
    query: async (sql, params) => {
      if (intercept) return intercept({ db, sql, params });
      return db.query(sql, params);
    },
    release() {}
  });
}

function command(requestKey, overrides = {}) {
  return {
    requestKey,
    customer: {
      provider: 'telegram',
      providerUserId: '700001',
      username: '@new_customer',
      firstName: 'New',
      lastName: 'Customer',
      photoUrl: 'https://cdn.example.test/avatar.png',
      ...overrides
    }
  };
}

test('manual request-ledger migration is additive, idempotent and performs no backfill', async () => {
  const sql = await fs.readFile(createRequestMigrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS spaceverse_customer_create_requests/i);
  assert.match(sql, /FOREIGN KEY \(runtime_key, company_id, venue_id\)/i);
  assert.match(sql, /CHECK \(\(user_id IS NULL\) = \(completed_at IS NULL\)\)/i);
  assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/im);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i);
  assert.doesNotMatch(sql, /ALTER TABLE\s+(?:users|wallets|user_identities)\b/i);
  assert.equal(isAutomaticStartupMigration('020_spaceverse_customer_create_requests.sql'), false);

  const db = new PGlite();
  try {
    await createBaseSchema(db);
    for (const migrationUrl of migrationUrls.slice(0, 3)) {
      await db.exec(await fs.readFile(migrationUrl, 'utf8'));
    }
    await db.exec(sql);
    await db.exec(sql);
    assert.equal(
      (await db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_customer_create_requests')).rows[0].count,
      0
    );
  } finally {
    await db.close();
  }
});

test('one transaction creates a new canonical customer, identity, zero wallet and exact ownership', async () => {
  const fixture = await tenantDatabase({ seed: 'a', companyId: '700', venueId: '701' });
  try {
    const provision = createSpaceverseCustomerProvisioner({
      runtime: fixture.runtime,
      connect: connection(fixture.db)
    });
    const result = await provision(command('10000000-0000-4000-8000-000000000001'));

    assert.deepEqual(result, {
      requestKey: '10000000-0000-4000-8000-000000000001',
      customer: { id: '1', provider: 'telegram', providerUserId: '700001' },
      wallet: { userId: '1' },
      ownership: { userId: '1' }
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.customer), true);
    const readCustomerWallet = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: fixture.db.query.bind(fixture.db)
    });
    const customerWallet = await readCustomerWallet({ userId: result.customer.id });
    assert.equal(customerWallet.customer.username, 'new_customer');
    assert.equal(customerWallet.wallet.balance, '0');
    assert.deepEqual(
      (await fixture.db.query(`SELECT
         u.id::text,u.telegram_id::text,u.username,u.first_name,u.last_name,u.photo_url,u.role,
         i.provider,i.provider_user_id,i.provider_username,w.balance::text,
         o.runtime_key,o.company_id,o.venue_id,r.request_key::text,r.user_id::text,
         r.completed_at IS NOT NULL AS completed
       FROM users u
       JOIN user_identities i ON i.user_id=u.id
       JOIN wallets w ON w.user_id=u.id
       JOIN spaceverse_customer_ownership o ON o.user_id=u.id
       JOIN spaceverse_customer_create_requests r ON r.user_id=u.id`)).rows,
      [{
        id: '1', telegram_id: '700001', username: 'new_customer', first_name: 'New',
        last_name: 'Customer', photo_url: 'https://cdn.example.test/avatar.png', role: 'client', provider: 'telegram',
        provider_user_id: '700001', provider_username: 'new_customer', balance: '0',
        runtime_key: fixture.manifest.runtimeKey, company_id: '700', venue_id: '701',
        request_key: '10000000-0000-4000-8000-000000000001', user_id: '1', completed: true
      }]
    );
    assert.equal(customerProvisioningContract.providerIdentityAdoption, false);
    assert.equal(customerProvisioningContract.runtimeBindingRecheckedInTransaction, true);
    assert.equal(customerProvisioningContract.runtimeRequestScopeAccepted, false);
    assert.equal(customerProvisioningContract.productionWiringEnabled, false);
  } finally {
    await fixture.db.close();
  }
});

test('exact replay returns the original resource and conflicting replay changes nothing', async () => {
  const fixture = await tenantDatabase({ seed: 'b', companyId: '710', venueId: '711' });
  const requestKey = '20000000-0000-4000-8000-000000000002';
  try {
    const provision = createSpaceverseCustomerProvisioner({
      runtime: fixture.runtime,
      connect: connection(fixture.db)
    });
    const first = await provision(command(requestKey));
    const replay = await provision(command(requestKey));
    assert.deepEqual(replay, first);

    await assert.rejects(
      provision(command(requestKey, { firstName: 'Different' })),
      (error) => error?.code === 'SPACEVERSE_CUSTOMER_PROVISION_REPLAY_CONFLICT'
    );
    assert.equal((await fixture.db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 1);
    assert.equal((await fixture.db.query('SELECT COUNT(*)::integer AS count FROM wallets')).rows[0].count, 1);
    assert.equal(
      (await fixture.db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_customer_ownership')).rows[0].count,
      1
    );
  } finally {
    await fixture.db.close();
  }
});

test('retry after a lost COMMIT response recovers the same customer without duplicates', async () => {
  const fixture = await tenantDatabase({ seed: 'c', companyId: '720', venueId: '721' });
  const requestKey = '30000000-0000-4000-8000-000000000003';
  let loseFirstCommit = true;
  try {
    const uncertainProvision = createSpaceverseCustomerProvisioner({
      runtime: fixture.runtime,
      connect: connection(fixture.db, async ({ db, sql, params }) => {
        const result = await db.query(sql, params);
        if (loseFirstCommit && /^COMMIT$/i.test(sql.trim())) {
          loseFirstCommit = false;
          throw new Error('socket closed after commit with internal details');
        }
        return result;
      })
    });
    await assert.rejects(
      uncertainProvision(command(requestKey)),
      (error) => error?.code === 'SPACEVERSE_CUSTOMER_PROVISION_UNAVAILABLE'
        && !String(error?.message).includes('internal details')
    );

    const retryProvision = createSpaceverseCustomerProvisioner({
      runtime: fixture.runtime,
      connect: connection(fixture.db)
    });
    const recovered = await retryProvision(command(requestKey));
    assert.equal(recovered.customer.id, '1');
    assert.equal((await fixture.db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 1);
    assert.equal(
      (await fixture.db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_customer_create_requests')).rows[0].count,
      1
    );
  } finally {
    await fixture.db.close();
  }
});

test('historical Telegram and VK identities are rejected and never adopted', async () => {
  const fixture = await tenantDatabase({ seed: 'd', companyId: '730', venueId: '731' });
  try {
    await fixture.db.query(
      `INSERT INTO users(telegram_id,username,first_name,role)
       VALUES(700001,'legacy_tg','Legacy Telegram','client'),
             (NULL,'legacy_vk','Legacy VK','client')`
    );
    await fixture.db.query(
      `INSERT INTO user_identities(user_id,provider,provider_user_id,provider_username)
       VALUES(2,'vk','800002','legacy_vk')`
    );
    const provision = createSpaceverseCustomerProvisioner({
      runtime: fixture.runtime,
      connect: connection(fixture.db)
    });

    await assert.rejects(
      provision(command('40000000-0000-4000-8000-000000000004')),
      (error) => error?.code === 'SPACEVERSE_CUSTOMER_PROVISION_IDENTITY_CONFLICT'
    );
    await assert.rejects(
      provision(command('40000000-0000-4000-8000-000000000005', {
        provider: 'vk', providerUserId: '800002', username: 'legacy_vk'
      })),
      (error) => error?.code === 'SPACEVERSE_CUSTOMER_PROVISION_IDENTITY_CONFLICT'
    );
    assert.equal((await fixture.db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 2);
    assert.equal((await fixture.db.query('SELECT COUNT(*)::integer AS count FROM wallets')).rows[0].count, 0);
    assert.equal(
      (await fixture.db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_customer_ownership')).rows[0].count,
      0
    );
    assert.equal(
      (await fixture.db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_customer_create_requests')).rows[0].count,
      0
    );
  } finally {
    await fixture.db.close();
  }
});

test('two tenants and two venues in one company reject cross-database provisioning', async () => {
  const first = await tenantDatabase({ seed: 'e', companyId: '800', venueId: '801' });
  const second = await tenantDatabase({ seed: 'f', companyId: '800', venueId: '802' });
  const foreign = await tenantDatabase({ seed: '9', companyId: '900', venueId: '901' });
  try {
    const firstProvision = createSpaceverseCustomerProvisioner({
      runtime: first.runtime,
      connect: connection(first.db)
    });
    const secondProvision = createSpaceverseCustomerProvisioner({
      runtime: second.runtime,
      connect: connection(second.db)
    });
    assert.equal(
      (await firstProvision(command('50000000-0000-4000-8000-000000000001'))).customer.id,
      '1'
    );
    assert.equal(
      (await secondProvision(command('50000000-0000-4000-8000-000000000002', {
        providerUserId: '700002'
      }))).customer.id,
      '1'
    );

    for (const [runtime, db, requestKey] of [
      [first.runtime, second.db, '50000000-0000-4000-8000-000000000003'],
      [foreign.runtime, first.db, '50000000-0000-4000-8000-000000000004']
    ]) {
      const crossProvision = createSpaceverseCustomerProvisioner({
        runtime,
        connect: connection(db)
      });
      await assert.rejects(
        crossProvision(command(requestKey, { providerUserId: '700099' })),
        (error) => error?.code === 'SPACEVERSE_CUSTOMER_PROVISION_REJECTED'
      );
    }
    assert.equal((await first.db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 1);
    assert.equal((await second.db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 1);
  } finally {
    await first.db.close();
    await second.db.close();
    await foreign.db.close();
  }
});

test('request scope, unsafe input and forged runtimes are rejected before connecting', async () => {
  const fixture = await tenantDatabase({ seed: '7', companyId: '910', venueId: '911' });
  let connections = 0;
  try {
    const provision = createSpaceverseCustomerProvisioner({
      runtime: fixture.runtime,
      connect: async () => {
        connections += 1;
        return (await connection(fixture.db))();
      }
    });
    await assert.rejects(
      provision({ ...command('60000000-0000-4000-8000-000000000001'), tenantId: 'attacker' }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN'
    );
    await assert.rejects(
      provision(command('60000000-0000-4000-8000-000000000002', { venueId: 'other' })),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN'
    );
    await assert.rejects(
      provision(command('not-a-uuid', { providerUserId: '1 OR 1=1' })),
      /UUID v4/
    );
    await assert.rejects(
      provision(command('60000000-0000-4000-8000-000000000003', {
        photoUrl: 'http://127.0.0.1/private-avatar'
      })),
      /valid HTTPS URL/
    );
    assert.equal(connections, 0);

    assert.throws(
      () => createSpaceverseCustomerProvisioner({
        runtime: {
          mode: 'tenant',
          context: { tenantId: '910', locationId: '911' },
          binding: { runtimeKey: fixture.manifest.runtimeKey }
        },
        connect: async () => { connections += 1; return {}; }
      }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED'
    );
    assert.equal(connections, 0);
  } finally {
    await fixture.db.close();
  }
});

test('transaction failure rolls back all partial rows and sanitizes database details', async () => {
  const fixture = await tenantDatabase({ seed: '8', companyId: '920', venueId: '921' });
  try {
    const provision = createSpaceverseCustomerProvisioner({
      runtime: fixture.runtime,
      connect: connection(fixture.db, async ({ db, sql, params }) => {
        if (/^INSERT INTO wallets/i.test(sql.trim())) {
          throw new Error('relation secret_customer_wallet does not exist');
        }
        return db.query(sql, params);
      })
    });
    await assert.rejects(
      provision(command('70000000-0000-4000-8000-000000000001')),
      (error) => error?.code === 'SPACEVERSE_CUSTOMER_PROVISION_UNAVAILABLE'
        && !String(error?.message).includes('secret_customer_wallet')
    );
    for (const table of [
      'users',
      'user_identities',
      'wallets',
      'spaceverse_customer_ownership',
      'spaceverse_customer_create_requests'
    ]) {
      assert.equal(
        (await fixture.db.query(`SELECT COUNT(*)::integer AS count FROM ${table}`)).rows[0].count,
        0
      );
    }
  } finally {
    await fixture.db.close();
  }
});
