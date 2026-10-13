import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';

// Startup applies exactly this set from the real migrations/ directory. Adding a SQL
// file never adds it here; a deliberate change to this list is a reviewed release decision.
const AUTOMATIC = [
  '001_add_platform_identities.sql', '002_countable_achievements.sql', '003_account_deletion.sql',
  '004_deleted_identity_tombstones.sql', '005_runtime_identity.sql', '006_telegram_wheel.sql',
  '007_red_cosmos_v2.sql', '008_tester_recipient_aliases.sql', '010_repair_originaltopg_admin.sql',
  '015_wheel_halloween_ticket.sql', '016_run_scores.sql'
];
const MANUAL_SPACEVERSE = [
  '009_spaceverse_tenant_attribution.sql', '010_spaceverse_customer_metadata.sql', '011_spaceverse_scope_directory.sql'
];

test('startup selects exactly the approved migrations from the real directory; SPACEVERSE SQL stays manual', async () => {
  const files = (await fs.readdir(new URL('../migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter(isAutomaticStartupMigration), AUTOMATIC);
  for (const name of MANUAL_SPACEVERSE) {
    assert.ok(files.includes(name), `${name} exists`);
    assert.equal(isAutomaticStartupMigration(name), false, `${name} must not run at startup`);
  }
  for (const name of ['011_halloween_raffle.sql', '012_evotor_sales.sql', '013_evotor_pos_scope_devices.sql', '014_evotor_bonus_accrual.sql']) {
    assert.equal(isAutomaticStartupMigration(name), false, `${name} is operator-applied`);
  }
});
