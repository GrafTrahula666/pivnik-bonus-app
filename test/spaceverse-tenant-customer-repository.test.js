import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import {
  createSpaceverseRuntimeManifest,
  resolveSpaceverseRuntime
} from '../spaceverse-runtime-manifest.js';
import {
  createSpaceverseTenantCustomerRepository,
  tenantCustomerRepositoryContract
} from '../tenant-customer-repository.js';

const bindingMigrationUrl = new URL('../migrations/017_spaceverse_runtime_binding.sql', import.meta.url);
const scopeMigrationUrl = new URL('../migrations/018_spaceverse_runtime_scope_binding.sql', import.meta.url);
const customersMigrationUrl = new URL('../migrations/019_spaceverse_tenant_customers.sql', import.meta.url);

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

async function tenantDatabase({ seed, companyId, venueId, withLegacyUsers = false }) {
  const db = new PGlite();
  await db.exec(await fs.readFile(bindingMigrationUrl, 'utf8'));
  await db.exec(await fs.readFile(scopeMigrationUrl, 'utf8'));
  await db.exec(await fs.readFile(customersMigrationUrl, 'utf8'));

  if (withLegacyUsers) {
    // Simulates PIVNIK's historical users/wallets table existing in the same
    // database. The repository must never read it: it has no tenant columns
    // and no approved attribution.
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        display_name TEXT,
        wallet_balance BIGINT
      )
    `);
    await db.query(
      `INSERT INTO users(display_name, wallet_balance) VALUES($1, $2)`,
      ['legacy pivnik user', 999999]
    );
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
  return { db, runtime };
}

async function seedCustomer(db, { companyId, venueId, externalRef, walletBalance = 0 }) {
  await db.query(
    `INSERT INTO spaceverse_tenant_customers(company_id, venue_id, external_ref, wallet_balance)
     VALUES($1, $2, $3, $4)`,
    [companyId, venueId, externalRef, walletBalance]
  );
}

test('reads only rows matching its own verified company/venue binding', async () => {
  const fixture = await tenantDatabase({ seed: '2', companyId: '800', venueId: '801' });
  await seedCustomer(fixture.db, { companyId: '800', venueId: '801', externalRef: 'guest-1', walletBalance: 500 });
  await seedCustomer(fixture.db, { companyId: '800', venueId: '801', externalRef: 'guest-2', walletBalance: 100 });

  const list = createSpaceverseTenantCustomerRepository({ query: fixture.db.query.bind(fixture.db), runtime: fixture.runtime });
  const rows = await list();

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.external_ref).sort(), ['guest-1', 'guest-2']);
});

test('two different tenants in two separate databases never see each other\'s customers', async () => {
  const tenantA = await tenantDatabase({ seed: '3', companyId: '810', venueId: '811' });
  const tenantB = await tenantDatabase({ seed: '4', companyId: '820', venueId: '821' });
  await seedCustomer(tenantA.db, { companyId: '810', venueId: '811', externalRef: 'tenant-a-guest' });
  await seedCustomer(tenantB.db, { companyId: '820', venueId: '821', externalRef: 'tenant-b-guest' });

  const listA = createSpaceverseTenantCustomerRepository({ query: tenantA.db.query.bind(tenantA.db), runtime: tenantA.runtime });
  const listB = createSpaceverseTenantCustomerRepository({ query: tenantB.db.query.bind(tenantB.db), runtime: tenantB.runtime });

  assert.deepEqual((await listA()).map((row) => row.external_ref), ['tenant-a-guest']);
  assert.deepEqual((await listB()).map((row) => row.external_ref), ['tenant-b-guest']);
});

test('two different venues of the same company stay isolated from each other', async () => {
  const venueOne = await tenantDatabase({ seed: '5', companyId: '830', venueId: '831' });
  const venueTwo = await tenantDatabase({ seed: '6', companyId: '830', venueId: '832' });
  await seedCustomer(venueOne.db, { companyId: '830', venueId: '831', externalRef: 'venue-831-guest' });
  await seedCustomer(venueTwo.db, { companyId: '830', venueId: '832', externalRef: 'venue-832-guest' });

  const listOne = createSpaceverseTenantCustomerRepository({ query: venueOne.db.query.bind(venueOne.db), runtime: venueOne.runtime });
  const listTwo = createSpaceverseTenantCustomerRepository({ query: venueTwo.db.query.bind(venueTwo.db), runtime: venueTwo.runtime });

  assert.deepEqual((await listOne()).map((row) => row.external_ref), ['venue-831-guest']);
  assert.deepEqual((await listTwo()).map((row) => row.external_ref), ['venue-832-guest']);
});

test('rejects a request-supplied scope instead of trusting caller-provided arguments', async () => {
  const fixture = await tenantDatabase({ seed: '7', companyId: '840', venueId: '841' });
  const list = createSpaceverseTenantCustomerRepository({ query: fixture.db.query.bind(fixture.db), runtime: fixture.runtime });

  await assert.rejects(
    () => list({ companyId: '999', venueId: '999' }),
    (error) => error.code === 'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN'
  );
});

test('refuses to run against an unverified runtime object', () => {
  assert.throws(
    () => createSpaceverseTenantCustomerRepository({ query: async () => ({ rows: [] }), runtime: { mode: 'tenant' } }),
    (error) => error.code === 'SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED'
  );
});

test('never reads PIVNIK\'s legacy users/wallets table, even when present in the same database', async () => {
  const fixture = await tenantDatabase({ seed: '8', companyId: '850', venueId: '851', withLegacyUsers: true });
  await seedCustomer(fixture.db, { companyId: '850', venueId: '851', externalRef: 'tenant-guest', walletBalance: 10 });

  const list = createSpaceverseTenantCustomerRepository({ query: fixture.db.query.bind(fixture.db), runtime: fixture.runtime });
  const rows = await list();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].external_ref, 'tenant-guest');
  assert.equal(rows[0].wallet_balance, 10);
  // Contract/shape check: legacy table fields never leak into the result.
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['created_at', 'external_ref', 'id', 'updated_at', 'wallet_balance']);
  }
});

test('contract documents that this repository never touches legacy users/wallets', () => {
  assert.equal(tenantCustomerRepositoryContract.touchesLegacyUsersOrWallets, false);
  assert.equal(tenantCustomerRepositoryContract.readOnly, true);
  assert.equal(tenantCustomerRepositoryContract.requestScopeAllowed, false);
  assert.equal(tenantCustomerRepositoryContract.productionWiringEnabled, false);
});
