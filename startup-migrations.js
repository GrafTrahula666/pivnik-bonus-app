// Historical startup migrations only. A new SQL file is never authorization to
// apply it. SPACEVERSE 009+ require a separate, reviewed operator procedure.
const STARTUP_MIGRATIONS = new Set([
  '001_add_platform_identities.sql',
  '002_countable_achievements.sql',
  '003_account_deletion.sql',
  '004_deleted_identity_tombstones.sql',
  '005_runtime_identity.sql',
  '006_telegram_wheel.sql',
  '007_red_cosmos_v2.sql',
  '008_tester_recipient_aliases.sql'
]);
export function isStartupMigration(filename) {
  return STARTUP_MIGRATIONS.has(filename);
}
