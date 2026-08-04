import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

function useSsl(databaseUrl) {
  return !databaseUrl.includes('railway.internal')
    && !databaseUrl.includes('localhost')
    && !databaseUrl.includes('127.0.0.1');
}

export async function verifyProductionDatabase(databaseUrl) {
  const url = String(databaseUrl || '').trim();
  if (!url) throw new Error('DATABASE_URL is required.');

  const pool = new Pool({
    connectionString: url,
    ssl: useSsl(url) ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 10_000
  });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

      const identity = await client.query(
        'SELECT database_instance_id FROM runtime_identity WHERE singleton = TRUE LIMIT 1'
      );
      const databaseInstanceId = String(identity.rows[0]?.database_instance_id || '');
      if (!databaseInstanceId) throw new Error('runtime_identity is missing.');

      const duplicates = await client.query(
        `SELECT provider, provider_user_id, COUNT(*)::integer AS count
         FROM user_identities
         GROUP BY provider, provider_user_id
         HAVING COUNT(*) > 1
         LIMIT 20`
      );

      const walletMismatch = await client.query(
        `SELECT u.id,
                COALESCE(w.balance, 0)::bigint AS wallet_balance,
                COALESCE(SUM(
                  CASE WHEN t.status = 'completed'
                       THEN t.bonus_earned::bigint - t.bonus_spent::bigint
                       ELSE 0 END
                ), 0)::bigint AS ledger_balance
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
         LEFT JOIN transactions t ON t.client_id = u.id
         WHERE u.merged_into_user_id IS NULL
         GROUP BY u.id, w.balance
         HAVING COALESCE(w.balance, 0)::bigint <> COALESCE(SUM(
           CASE WHEN t.status = 'completed'
                THEN t.bonus_earned::bigint - t.bonus_spent::bigint
                ELSE 0 END
         ), 0)::bigint
         LIMIT 20`
      );

      const activeMerged = await client.query(
        `SELECT u.id, u.merged_into_user_id, COUNT(i.*)::integer AS identity_count
         FROM users u
         LEFT JOIN user_identities i ON i.user_id = u.id
         WHERE u.merged_into_user_id IS NOT NULL
         GROUP BY u.id, u.merged_into_user_id
         HAVING COUNT(i.*) > 0
         LIMIT 20`
      );

      const migrationState = await client.query(
        `SELECT filename, checksum, applied_at
         FROM platform_migrations
         ORDER BY filename`
      );

      await client.query('COMMIT');

      const failures = [];
      if (duplicates.rowCount) failures.push('duplicate platform identities');
      if (walletMismatch.rowCount) failures.push('wallet and ledger mismatch');
      if (activeMerged.rowCount) failures.push('merged users still own identities');
      if (!migrationState.rows.some((row) => row.filename === '005_runtime_identity.sql')) {
        failures.push('runtime identity migration is not applied');
      }

      return {
        ok: failures.length === 0,
        failures,
        databaseFingerprint: crypto
          .createHash('sha256')
          .update(databaseInstanceId)
          .digest('hex')
          .slice(0, 20),
        duplicateIdentities: duplicates.rows,
        walletMismatches: walletMismatch.rows,
        mergedUsersWithIdentities: activeMerged.rows,
        migrations: migrationState.rows.map((row) => row.filename)
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  verifyProductionDatabase(process.env.DATABASE_URL)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error?.message || error);
      process.exit(1);
    });
}
