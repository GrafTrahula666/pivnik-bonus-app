import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const achievementsSource = await readFile(new URL('../achievements.js', import.meta.url), 'utf8');
const adapterSource = await readFile(
  new URL('../achievement-transaction-persistence.js', import.meta.url),
  'utf8'
);

function compactSql(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

test('achievement journal is wired through the migration-gated adapter in legacy mode', () => {
  assert.match(
    achievementsSource,
    /import \{ createAchievementTransactionPersistence \} from '\.\/achievement-transaction-persistence\.js';/
  );
  assert.match(achievementsSource, /createAchievementTransactionPersistence\(\{/);
  assert.match(achievementsSource, /scopedWritesEnabled: false/);
  assert.match(achievementsSource, /await persistAchievementTransaction\(\{/);
  assert.doesNotMatch(
    achievementsSource,
    /await db\.query\(\s*`INSERT INTO transactions \(\s*request_key, client_id, mode, status, bonus_earned/
  );
});

test('achievement legacy adapter preserves the former production journal insert contract', () => {
  const requiredFragments = [
    'request_key, client_id, mode, status, bonus_earned',
    'beer_gift_earned_ml, balance_after, reason, reward_code, completed_at',
    "$1, $2::bigint, 'achievement', 'completed', $3::bigint",
    '$4::bigint, $5::bigint, $6, $7, NOW()'
  ];

  const compactAdapter = compactSql(adapterSource);
  for (const fragment of requiredFragments) {
    assert.ok(
      compactAdapter.includes(compactSql(fragment)),
      `achievement adapter drifted from legacy fragment: ${fragment}`
    );
  }
});

test('achievement grant idempotency remains before wallet and journal persistence', () => {
  const grantInsert = achievementsSource.indexOf('INSERT INTO reward_grants');
  const conflictGuard = achievementsSource.indexOf('ON CONFLICT (code, user_id) DO NOTHING', grantInsert);
  const noGrantReturn = achievementsSource.indexOf('if (!hasRows(inserted)) return false;', conflictGuard);
  const walletUpdate = achievementsSource.indexOf('UPDATE wallets', noGrantReturn);
  const persistenceCreate = achievementsSource.indexOf(
    'createAchievementTransactionPersistence({',
    walletUpdate
  );
  const journalPersist = achievementsSource.indexOf(
    'await persistAchievementTransaction({',
    persistenceCreate
  );

  assert.ok(grantInsert >= 0);
  assert.ok(conflictGuard > grantInsert);
  assert.ok(noGrantReturn > conflictGuard);
  assert.ok(walletUpdate > noGrantReturn);
  assert.ok(persistenceCreate > walletUpdate);
  assert.ok(journalPersist > persistenceCreate);
});

test('achievement synchronization still owns one transaction around awardAchievement calls', () => {
  const syncStart = achievementsSource.indexOf('export async function syncUserAchievements');
  const begin = achievementsSource.indexOf("client.query('BEGIN')", syncStart);
  const awardCall = achievementsSource.indexOf('await awardAchievement(', begin);
  const commit = achievementsSource.indexOf("client.query('COMMIT')", awardCall);
  const rollback = achievementsSource.indexOf("client.query('ROLLBACK')", commit);

  assert.ok(syncStart >= 0);
  assert.ok(begin > syncStart);
  assert.ok(awardCall > begin);
  assert.ok(commit > awardCall);
  assert.ok(rollback > commit);
});

test('scoped achievement persistence stays migration-gated and fallback-free', () => {
  assert.match(adapterSource, /scopedWritesEnabled = false/);
  assert.match(adapterSource, /createMigrationGatedTransactionPersistence/);
  assert.match(adapterSource, /scopedFallbackToLegacy: false/);
  assert.match(adapterSource, /requiresMigration009BeforeScopedEnablement: true/);
});
