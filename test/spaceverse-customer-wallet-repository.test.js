import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import {
  createSpaceverseCustomerWalletRepository,
  customerWalletRepositoryContract
} from '../customer-wallet-repository.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';
import { createSpaceverseCustomerDirectoryRepository } from '../customer-directory-repository.js';
import {
  createSpaceverseRuntimeManifest,
  resolveSpaceverseRuntime
} from '../spaceverse-runtime-manifest.js';

const bindingMigrationUrl = new URL('../migrations/017_spaceverse_runtime_binding.sql', import.meta.url);
const scopeMigrationUrl = new URL('../migrations/018_spaceverse_runtime_scope_binding.sql', import.meta.url);
const ownershipMigrationUrl = new URL('../migrations/019_spaceverse_customer_ownership.sql', import.meta.url);
const READ_ONLY_PATTERN = /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE)\b/i;

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
      id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT,
      photo_url TEXT,
      role TEXT NOT NULL DEFAULT 'client',
      deleted_at TIMESTAMPTZ,
      merged_into_user_id BIGINT REFERENCES users(id)
    );
    CREATE TABLE wallets (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function tenantDatabase({ seed, companyId, venueId, ownedBalance }) {
  const db = new PGlite();
  await createBaseSchema(db);
  await db.exec(await fs.readFile(bindingMigrationUrl, 'utf8'));
  await db.exec(await fs.readFile(scopeMigrationUrl, 'utf8'));
  await db.exec(await fs.readFile(ownershipMigrationUrl, 'utf8'));

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
  await db.query(
    `INSERT INTO users(id,username,first_name,last_name,photo_url,role)
     VALUES (11,$1,$2,'Owned','https://example.invalid/owned.jpg','client'),
            (12,$3,$4,'Legacy','https://example.invalid/legacy.jpg','client')`,
    [`owned-${venueId}`, `Owned ${venueId}`, `legacy-${venueId}`, `Legacy ${venueId}`]
  );
  await db.query(
    'INSERT INTO wallets(user_id,balance) VALUES(11,$1),(12,999999)',
    [ownedBalance]
  );
  await db.query(
    `INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
     VALUES(11,$1,$2,$3)`,
    [runtimeKey, companyId, venueId]
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

test('manual ownership migration is additive, idempotent and performs no customer backfill', async () => {
  const sql = await fs.readFile(ownershipMigrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS spaceverse_customer_ownership/i);
  assert.match(sql, /FOREIGN KEY \(runtime_key, company_id, venue_id\)/i);
  assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/im);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i);
  assert.doesNotMatch(sql, /ALTER TABLE\s+(?:users|wallets)\b/i);
  assert.equal(isAutomaticStartupMigration('019_spaceverse_customer_ownership.sql'), false);

  const db = new PGlite();
  try {
    await createBaseSchema(db);
    await db.exec(await fs.readFile(bindingMigrationUrl, 'utf8'));
    await db.exec(await fs.readFile(scopeMigrationUrl, 'utf8'));
    await db.exec(sql);
    await db.exec(sql);
    assert.equal(
      (await db.query('SELECT COUNT(*)::integer AS count FROM spaceverse_customer_ownership')).rows[0].count,
      0
    );
    await db.query(
      `INSERT INTO spaceverse_runtime_binding(
         singleton,runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status
       ) VALUES(TRUE,$1,$2,1,'600','601','dedicated_database','prepared')`,
      [`sv-${'6'.repeat(32)}`, '6'.repeat(64)]
    );
    await db.query("INSERT INTO users(id,first_name,role) VALUES(11,'Owned','client')");
    await assert.rejects(
      db.query(
        `INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
         VALUES(11,$1,'600','602')`,
        [`sv-${'6'.repeat(32)}`]
      ),
      /foreign key/i
    );
    await db.query(
      `INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
       VALUES(11,$1,'600','601')`,
      [`sv-${'6'.repeat(32)}`]
    );
    await assert.rejects(
      db.query("UPDATE spaceverse_runtime_binding SET venue_id='602' WHERE singleton=TRUE"),
      /foreign key/i
    );
  } finally {
    await db.close();
  }
});

test('verified runtime reads only an explicitly owned customer and wallet', async () => {
  const fixture = await tenantDatabase({ seed: 'a', companyId: '700', venueId: '701', ownedBalance: 125 });
  const calls = [];
  try {
    const loadCustomerWallet = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: async (sql, params) => {
        calls.push({ sql, params });
        return fixture.db.query(sql, params);
      }
    });

    const owned = await loadCustomerWallet({ userId: '11' });
    const historical = await loadCustomerWallet({ userId: '12' });

    assert.deepEqual(owned.customer, {
      id: '11',
      username: 'owned-701',
      firstName: 'Owned 701',
      lastName: 'Owned',
      photoUrl: 'https://example.invalid/owned.jpg',
      role: 'client'
    });
    assert.equal(owned.wallet.balance, '125');
    assert.ok(owned.wallet.updatedAt);
    assert.equal(Object.isFrozen(owned), true);
    assert.equal(Object.isFrozen(owned.customer), true);
    assert.equal(Object.isFrozen(owned.wallet), true);
    assert.equal(historical, null);
    assert.deepEqual(calls[0].params, [
      fixture.manifest.runtimeKey,
      fixture.manifest.manifestSha256,
      1,
      '700',
      '701',
      '11'
    ]);
    assert.match(calls[0].sql, /FROM spaceverse_runtime_binding/i);
    assert.match(calls[0].sql, /JOIN spaceverse_customer_ownership/i);
    assert.match(calls[0].sql, /JOIN users AS customer/i);
    assert.match(calls[0].sql, /LEFT JOIN wallets AS wallet/i);
    assert.doesNotMatch(calls[0].sql, READ_ONLY_PATTERN);
    assert.doesNotMatch(calls[0].sql, /\b700\b|\b701\b|\b11\b/);
  } finally {
    await fixture.db.close();
  }
});

test('two tenants and two venues in one company cannot cross-read customer wallets', async () => {
  const first = await tenantDatabase({ seed: 'b', companyId: '800', venueId: '801', ownedBalance: 101 });
  const second = await tenantDatabase({ seed: 'c', companyId: '800', venueId: '802', ownedBalance: 202 });
  const foreign = await tenantDatabase({ seed: 'd', companyId: '900', venueId: '901', ownedBalance: 303 });
  try {
    const firstRead = createSpaceverseCustomerWalletRepository({
      runtime: first.runtime,
      query: first.db.query.bind(first.db)
    });
    const secondRead = createSpaceverseCustomerWalletRepository({
      runtime: second.runtime,
      query: second.db.query.bind(second.db)
    });
    assert.equal((await firstRead({ userId: 11 })).wallet.balance, '101');
    assert.equal((await secondRead({ userId: 11n })).wallet.balance, '202');

    for (const [runtime, targetDb] of [
      [first.runtime, second.db],
      [foreign.runtime, first.db]
    ]) {
      const crossRead = createSpaceverseCustomerWalletRepository({
        runtime,
        query: targetDb.query.bind(targetDb)
      });
      await assert.rejects(
        crossRead({ userId: '11' }),
        (error) => error?.code === 'SPACEVERSE_CUSTOMER_WALLET_READ_REJECTED'
      );
    }
  } finally {
    await first.db.close();
    await second.db.close();
    await foreign.db.close();
  }
});

test('directory cross-tenant database substitution fails closed before returning customer data', async () => {
  const first = await tenantDatabase({ seed: 'a', companyId: '940', venueId: '941', ownedBalance: 111 });
  const sibling = await tenantDatabase({ seed: 'b', companyId: '940', venueId: '942', ownedBalance: 222 });
  const foreign = await tenantDatabase({ seed: 'c', companyId: '950', venueId: '951', ownedBalance: 333 });
  try {
    const own = createSpaceverseCustomerDirectoryRepository({
      runtime: first.runtime,
      query: first.db.query.bind(first.db)
    });
    assert.equal((await own()).items[0].wallet.balance, '111');
    for (const target of [sibling, foreign]) {
      const substituted = createSpaceverseCustomerDirectoryRepository({
        runtime: first.runtime,
        query: target.db.query.bind(target.db)
      });
      await assert.rejects(substituted(), {
        code: 'SPACEVERSE_DIRECTORY_BINDING_REJECTED'
      });
    }
  } finally {
    await first.db.close();
    await sibling.db.close();
    await foreign.db.close();
  }
});

test('wallet read fails closed after a verified runtime binding manifest changes', async () => {
  const fixture = await tenantDatabase({ seed: 'a', companyId: '810', venueId: '811', ownedBalance: 606 });
  try {
    const load = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: fixture.db.query.bind(fixture.db)
    });
    assert.equal((await load({ userId: '11' })).wallet.balance, '606');

    await fixture.db.query("UPDATE spaceverse_runtime_binding SET manifest_sha256=$1 WHERE singleton=TRUE", ['0'.repeat(64)]);
    await assert.rejects(load({ userId: '11' }), {
      code: 'SPACEVERSE_CUSTOMER_WALLET_READ_REJECTED'
    });

    const balance = await fixture.db.query('SELECT balance::text AS balance FROM wallets WHERE user_id=11');
    assert.equal(balance.rows[0].balance, '606');
  } finally {
    await fixture.db.close();
  }
});

test('wallet read rejects a changed binding revision after initial authorization', async () => {
  const fixture = await tenantDatabase({ seed: 'd', companyId: '816', venueId: '817', ownedBalance: 909 });
  try {
    const load = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: fixture.db.query.bind(fixture.db)
    });
    assert.equal((await load({ userId: '11' })).wallet.balance, '909');

    await fixture.db.query(
      'UPDATE spaceverse_runtime_binding SET manifest_revision=manifest_revision+1 WHERE singleton=TRUE'
    );
    await assert.rejects(load({ userId: '11' }), {
      code: 'SPACEVERSE_CUSTOMER_WALLET_READ_REJECTED'
    });
    const stored = await fixture.db.query('SELECT balance::text AS balance FROM wallets WHERE user_id=11');
    assert.equal(stored.rows[0].balance, '909');
  } finally {
    await fixture.db.close();
  }
});

test('wallet ownership revocation denies subsequent direct-ID reads without altering balance', async () => {
  const fixture = await tenantDatabase({ seed: 'b', companyId: '812', venueId: '813', ownedBalance: 707 });
  try {
    const load = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: fixture.db.query.bind(fixture.db)
    });
    assert.equal((await load({ userId: '11' })).wallet.balance, '707');

    await fixture.db.query('DELETE FROM spaceverse_customer_ownership WHERE user_id=$1', [11]);
    assert.equal(await load({ userId: '11' }), null);
    const balance = await fixture.db.query('SELECT balance::text AS balance FROM wallets WHERE user_id=$1', [11]);
    assert.equal(balance.rows[0].balance, '707');
  } finally {
    await fixture.db.close();
  }
});

test('ownership reassignment immediately revokes old direct-ID access without moving wallet balances', async () => {
  const fixture = await tenantDatabase({ seed: 'c', companyId: '814', venueId: '815', ownedBalance: 808 });
  try {
    const load = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: fixture.db.query.bind(fixture.db)
    });
    assert.equal((await load({ userId: '11' })).wallet.balance, '808');
    assert.equal(await load({ userId: '12' }), null);

    await fixture.db.query(
      'UPDATE spaceverse_customer_ownership SET user_id=$1 WHERE user_id=$2',
      [12, 11]
    );

    assert.equal(await load({ userId: '11' }), null);
    assert.equal((await load({ userId: '12' })).wallet.balance, '999999');
    const balances = await fixture.db.query(
      'SELECT user_id::text AS user_id, balance::text AS balance FROM wallets ORDER BY user_id'
    );
    assert.deepEqual(balances.rows.map(({ user_id, balance }) => [user_id, balance]), [
      ['11', '808'],
      ['12', '999999']
    ]);
  } finally {
    await fixture.db.close();
  }
});

test('request scope, malformed ids and forged runtimes are rejected before customer SQL', async () => {
  const fixture = await tenantDatabase({ seed: 'e', companyId: '910', venueId: '911', ownedBalance: 404 });
  let queries = 0;
  try {
    const loadCustomerWallet = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: async (...args) => {
        queries += 1;
        return fixture.db.query(...args);
      }
    });
    await assert.rejects(
      loadCustomerWallet({ userId: '11', tenantId: 'attacker', locationId: 'other' }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN'
    );
    await assert.rejects(loadCustomerWallet({ userId: '0 OR 1=1' }), /canonical positive bigint/);
    assert.equal(queries, 0);

    assert.throws(
      () => createSpaceverseCustomerWalletRepository({
        runtime: {
          mode: 'tenant',
          context: { tenantId: '910', locationId: '911' },
          binding: { runtimeKey: fixture.manifest.runtimeKey }
        },
        query: async () => { queries += 1; return { rows: [] }; }
      }),
      (error) => error?.code === 'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED'
    );
    assert.equal(queries, 0);
    assert.equal(customerWalletRepositoryContract.ownershipBackfill, false);
    assert.equal(customerWalletRepositoryContract.runtimeBindingRecheckedInRead, true);
    assert.equal(customerWalletRepositoryContract.runtimeRequestScopeAccepted, false);
    assert.equal(customerWalletRepositoryContract.fallbackToLegacyUsers, false);
    assert.equal(customerWalletRepositoryContract.productionWiringEnabled, false);
  } finally {
    await fixture.db.close();
  }
});

test('database failures and malformed rows are sanitized and fail closed', async () => {
  const fixture = await tenantDatabase({ seed: 'f', companyId: '920', venueId: '921', ownedBalance: 505 });
  try {
    const unavailable = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: async () => { throw new Error('relation secret_internal does not exist'); }
    });
    await assert.rejects(
      unavailable({ userId: '11' }),
      (error) => error?.code === 'SPACEVERSE_CUSTOMER_WALLET_READ_UNAVAILABLE'
        && !String(error?.message).includes('secret_internal')
    );

    const malformed = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: async () => ({ rows: [] })
    });
    await assert.rejects(
      malformed({ userId: '11' }),
      (error) => error?.code === 'SPACEVERSE_CUSTOMER_WALLET_READ_INVALID_RESULT'
    );
  } finally {
    await fixture.db.close();
  }
});

test('directory uses explicit ownership, literal search and exact wallet values in one read-only statement', async () => {
  const fixture = await tenantDatabase({ seed: 'd', companyId: '910', venueId: '911', ownedBalance: '9007199254740993' });
  try {
    await fixture.db.query("UPDATE users SET first_name='Анна_100%',last_name='Иванова' WHERE id=11");
    const calls=[];
    const list=createSpaceverseCustomerDirectoryRepository({runtime:fixture.runtime,query:async(sql,params)=>{
      calls.push(sql);return fixture.db.query(sql,params);
    }});
    for(const q of ['Анна','_100%','Иванова']) {
      const result=await list({q,limit:1});
      assert.equal(result.total,'1');assert.equal(result.items[0].wallet.balance,'9007199254740993');
    }
    assert.equal((await list({q:"' OR TRUE --"})).total,'0');
    assert.equal((await list({q:'Legacy'})).items.length,0);
    assert.deepEqual((await list({offset:100})).items,[]);
    assert.ok(calls.every(sql=>!READ_ONLY_PATTERN.test(sql)));
  } finally {await fixture.db.close();}
});

test('directory immediately hides revoked ownership without changing stored wallet balances', async () => {
  const fixture = await tenantDatabase({ seed: 'a', companyId: '932', venueId: '933', ownedBalance: 314 });
  try {
    const list = createSpaceverseCustomerDirectoryRepository({
      runtime: fixture.runtime,
      query: fixture.db.query.bind(fixture.db)
    });
    const before = await list({ q: 'Owned' });
    assert.equal(before.total, '1');
    assert.equal(before.items[0].wallet.balance, '314');

    await fixture.db.query('DELETE FROM spaceverse_customer_ownership WHERE user_id=$1', [11]);

    const after = await list({ q: 'Owned' });
    assert.equal(after.total, '0');
    assert.deepEqual(after.items, []);
    const stored = await fixture.db.query('SELECT balance::text AS balance FROM wallets WHERE user_id=$1', [11]);
    assert.equal(stored.rows[0].balance, '314');
  } finally {
    await fixture.db.close();
  }
});

test('directory ownership reassignment removes old customer and exposes only newly owned customer', async () => {
  const fixture = await tenantDatabase({ seed: 'b', companyId: '934', venueId: '935', ownedBalance: 515 });
  try {
    const list = createSpaceverseCustomerDirectoryRepository({
      runtime: fixture.runtime,
      query: fixture.db.query.bind(fixture.db)
    });
    assert.deepEqual((await list()).items.map(item => item.customer.id), ['11']);

    await fixture.db.query(
      'UPDATE spaceverse_customer_ownership SET user_id=$1 WHERE user_id=$2',
      [12, 11]
    );

    const after = await list();
    assert.equal(after.total, '1');
    assert.deepEqual(after.items.map(item => item.customer.id), ['12']);
    assert.equal(after.items[0].wallet.balance, '999999');
    assert.equal((await list({ q: 'Owned' })).total, '0');
    const balances = await fixture.db.query(
      'SELECT user_id::text AS id, balance::text AS balance FROM wallets ORDER BY user_id'
    );
    assert.deepEqual(balances.rows.map(row => [row.id, row.balance]), [
      ['11', '515'],
      ['12', '999999']
    ]);
  } finally {
    await fixture.db.close();
  }
});

test('directory rejects request scope and unverified runtime objects before querying customer data', async () => {
  const fixture=await tenantDatabase({seed:'e',companyId:'920',venueId:'921',ownedBalance:0});
  try {
    let calls=0;
    const query=async()=>{calls++;throw new Error('must not query');};
    const list=createSpaceverseCustomerDirectoryRepository({runtime:fixture.runtime,query});
    await assert.rejects(list({companyId:'930'}),{code:'SPACEVERSE_DIRECTORY_REQUEST_SCOPE_FORBIDDEN'});
    for(const options of [{limit:0},{limit:101},{offset:-1},{offset:1000001},{q:'x'.repeat(101)}])
      await assert.rejects(list(options),TypeError);
    assert.throws(()=>createSpaceverseCustomerDirectoryRepository({runtime:{...fixture.runtime},query}),
      {code:'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED'});
    assert.equal(calls,0);
  } finally {await fixture.db.close();}
});

test('directory refuses a changed binding revision after initial authorization', async () => {
  const fixture = await tenantDatabase({ seed: 'c', companyId: '936', venueId: '937', ownedBalance: 616 });
  try {
    const list = createSpaceverseCustomerDirectoryRepository({
      runtime: fixture.runtime,
      query: fixture.db.query.bind(fixture.db)
    });
    assert.equal((await list()).items[0].wallet.balance, '616');

    await fixture.db.query(
      'UPDATE spaceverse_runtime_binding SET manifest_revision=manifest_revision+1 WHERE singleton=TRUE'
    );
    await assert.rejects(list(), { code: 'SPACEVERSE_DIRECTORY_BINDING_REJECTED' });
    const stored = await fixture.db.query('SELECT balance::text AS balance FROM wallets WHERE user_id=11');
    assert.equal(stored.rows[0].balance, '616');
  } finally {
    await fixture.db.close();
  }
});

test('wallet and directory fail closed when database reads become unavailable after authorization', async () => {
  const fixture = await tenantDatabase({ seed: 'e', companyId: '938', venueId: '939', ownedBalance: 717 });
  let unavailable = false;
  const query = async (sql, params) => {
    if (unavailable) throw new Error('database unavailable');
    return fixture.db.query(sql, params);
  };
  try {
    const load = createSpaceverseCustomerWalletRepository({ runtime: fixture.runtime, query });
    const list = createSpaceverseCustomerDirectoryRepository({ runtime: fixture.runtime, query });
    assert.equal((await load({ userId: '11' })).wallet.balance, '717');
    assert.equal((await list()).total, '1');

    unavailable = true;
    await assert.rejects(load({ userId: '11' }), { code: 'SPACEVERSE_CUSTOMER_WALLET_READ_UNAVAILABLE' });
    await assert.rejects(list(), { code: 'SPACEVERSE_DIRECTORY_READ_UNAVAILABLE' });
    const stored = await fixture.db.query('SELECT balance::text AS balance FROM wallets WHERE user_id=11');
    assert.equal(stored.rows[0].balance, '717');
  } finally {
    await fixture.db.close();
  }
});

test('directory refuses a changed binding even when the runtime was previously verified', async () => {
  const fixture=await tenantDatabase({seed:'f',companyId:'930',venueId:'931',ownedBalance:42});
  try {
    const list=createSpaceverseCustomerDirectoryRepository({runtime:fixture.runtime,query:fixture.db.query.bind(fixture.db)});
    assert.equal((await list()).items[0].wallet.balance,'42');
    await fixture.db.query('UPDATE spaceverse_runtime_binding SET manifest_sha256=$1',['0'.repeat(64)]);
    await assert.rejects(list(),{code:'SPACEVERSE_DIRECTORY_BINDING_REJECTED'});
  } finally {await fixture.db.close();}
});

test('directory rejects a forged ownership scope in query results without exposing a customer', async () => {
  const fixture = await tenantDatabase({ seed: 'd', companyId: '952', venueId: '953', ownedBalance: 424 });
  try {
    for (const forgedScope of [
      { ownership_venue_id: '954' },
      { ownership_company_id: '999' },
      { ownership_runtime_key: 'forged-runtime-key' },
      { role: 'admin' }
    ]) {
      const list = createSpaceverseCustomerDirectoryRepository({
        runtime: fixture.runtime,
        query: async (sql, params) => {
          const result = await fixture.db.query(sql, params);
          return {
            ...result,
            rows: result.rows.map(row => row.user_id === '11'
              ? { ...row, ...forgedScope }
              : row)
          };
        }
      });
      await assert.rejects(list(), { code: 'SPACEVERSE_DIRECTORY_SCOPE_MISMATCH' });
    }
    const balance = await fixture.db.query('SELECT balance::text AS balance FROM wallets WHERE user_id=11');
    assert.equal(balance.rows[0].balance, '424');
  } finally {
    await fixture.db.close();
  }
});


test('wallet direct-ID read rejects a forged admin role in returned customer row', async () => {
  const fixture = await tenantDatabase({ seed: 'f', companyId: '960', venueId: '961', ownedBalance: 818 });
  try {
    const load = createSpaceverseCustomerWalletRepository({
      runtime: fixture.runtime,
      query: async (sql, params) => {
        const result = await fixture.db.query(sql, params);
        return { ...result, rows: result.rows.map(row => row.user_id === '11'
          ? { ...row, role: 'admin' }
          : row) };
      }
    });
    await assert.rejects(load({ userId: '11' }), {
      code: 'SPACEVERSE_CUSTOMER_WALLET_READ_SCOPE_MISMATCH'
    });
    const balance = await fixture.db.query('SELECT balance::text AS balance FROM wallets WHERE user_id=11');
    assert.equal(balance.rows[0].balance, '818');
  } finally {
    await fixture.db.close();
  }
});
