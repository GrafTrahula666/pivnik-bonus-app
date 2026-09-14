// Only the established production migrations are automatic. A new numbered
// file is not deployment authorization: gated/manual migrations require their
// own reviewed operator procedure. In particular, 009 must not run at startup.
const automaticMigrations = new Set([
  '001_add_platform_identities.sql',
  '002_countable_achievements.sql',
  '003_account_deletion.sql',
  '004_deleted_identity_tombstones.sql',
  '005_runtime_identity.sql',
  '006_telegram_wheel.sql',
  '007_red_cosmos_v2.sql',
  '008_tester_recipient_aliases.sql'
]);

export function isAutomaticStartupMigration(filename) {
  return automaticMigrations.has(filename);
}
