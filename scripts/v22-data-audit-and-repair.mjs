import pg from 'pg';

const { Pool } = pg;
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const repairConfirmed = process.env.PIVNIK_V22_REPAIR_CONFIRM === 'REPAIR_PIVNIK_V22_20260827';
const TESTER_HANDLES = ['drolted', 'distraktor', 'ksemar'];
const TESTER_REWARD = 750;
const ACHIEVEMENT_CODE = 'raise-shields';
const GRANT_CODE = `achievement:${ACHIEVEMENT_CODE}`;

if (!databaseUrl) {
  console.error('DATABASE_URL is required for the v22 data audit.');
  process.exit(2);
}

const useSsl = !databaseUrl.includes('railway.internal');
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 2,
  connectionTimeoutMillis: 10_000
});

function cleanHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

async function tableExists(name) {
  const result = await pool.query(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [name]
  );
  return Boolean(result.rows[0]?.ok);
}

async function audit() {
  const [users, wallets, tx, beer, frames, identities, fingerprint] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) FILTER (WHERE merged_into_user_id IS NULL AND deleted_at IS NULL)::int AS active,
             COUNT(*) FILTER (WHERE merged_into_user_id IS NOT NULL)::int AS merged,
             COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted
      FROM users
    `),
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE balance > 0)::int AS nonzero,
             COUNT(*) FILTER (WHERE balance = 0)::int AS zero,
             COALESCE(SUM(balance),0)::bigint AS total_balance
      FROM wallets
    `),
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status='completed')::int AS completed,
             COUNT(DISTINCT client_id) FILTER (WHERE status='completed')::int AS clients,
             MIN(created_at) AS first_at,
             MAX(created_at) AS last_at
      FROM transactions
    `),
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE paid_ml_total > 0)::int AS with_paid_liters,
             COUNT(*) FILTER (WHERE gift_ml_balance > 0)::int AS with_gift_liters,
             COALESCE(SUM(paid_ml_total),0)::bigint AS paid_ml_total,
             COALESCE(SUM(gift_ml_balance),0)::bigint AS gift_ml_total
      FROM beer_loyalty
    `),
    pool.query(`
      SELECT profile_frame, COUNT(*)::int AS users
      FROM users
      WHERE merged_into_user_id IS NULL AND deleted_at IS NULL
      GROUP BY profile_frame ORDER BY users DESC, profile_frame
    `),
    tableExists('user_identities').then((exists) => exists
      ? pool.query(`SELECT provider, COUNT(*)::int AS identities, COUNT(DISTINCT user_id)::int AS users FROM user_identities GROUP BY provider ORDER BY provider`)
      : { rows: [] }),
    tableExists('runtime_identity').then((exists) => exists
      ? pool.query('SELECT database_instance_id::text AS id FROM runtime_identity WHERE singleton = TRUE LIMIT 1')
      : { rows: [] })
  ]);

  const mismatch = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (client_id) client_id, balance_after
      FROM transactions
      WHERE status='completed' AND balance_after IS NOT NULL
      ORDER BY client_id, completed_at DESC NULLS LAST, created_at DESC, id DESC
    )
    SELECT COUNT(*)::int AS count
    FROM latest l
    JOIN wallets w ON w.user_id=l.client_id
    JOIN users u ON u.id=l.client_id
    WHERE u.unlimited_bonus IS NOT TRUE
      AND u.role <> 'viewer'
      AND w.balance <> l.balance_after
  `);

  const testerRows = await pool.query(`
    WITH candidates AS (
      SELECT u.id, u.username, u.first_name, u.last_name, u.profile_frame,
             w.balance,
             COALESCE((SELECT COUNT(*) FROM transactions t WHERE t.client_id=u.id AND t.status='completed'),0)::int AS completed_ops,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT LOWER(COALESCE(ui.provider_username,''))), '') AS identity_usernames
      FROM users u
      JOIN wallets w ON w.user_id=u.id
      LEFT JOIN user_identities ui ON ui.user_id=u.id
      WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
      GROUP BY u.id, w.balance
    )
    SELECT * FROM candidates
    WHERE LOWER(COALESCE(username,'')) = ANY($1::text[])
       OR EXISTS (SELECT 1 FROM unnest(identity_usernames) name WHERE name = ANY($1::text[]))
    ORDER BY completed_ops DESC, id ASC
  `, [TESTER_HANDLES]);

  const testerMatches = Object.fromEntries(TESTER_HANDLES.map((handle) => [handle, []]));
  for (const row of testerRows.rows) {
    const names = [cleanHandle(row.username), ...(row.identity_usernames || []).map(cleanHandle)];
    for (const handle of TESTER_HANDLES) {
      if (names.includes(handle)) {
        testerMatches[handle].push({
          userId: String(row.id),
          username: row.username || null,
          name: [row.first_name, row.last_name].filter(Boolean).join(' '),
          balance: Number(row.balance || 0),
          completedOperations: Number(row.completed_ops || 0),
          frame: row.profile_frame || 'none'
        });
      }
    }
  }

  console.log(JSON.stringify({
    mode: repairConfirmed ? 'REPAIR_CONFIRMED' : 'READ_ONLY_DRY_RUN',
    databaseIdentityPresent: Boolean(fingerprint.rows[0]?.id),
    users: users.rows[0],
    wallets: wallets.rows[0],
    transactions: tx.rows[0],
    beer: beer.rows[0],
    platformIdentities: identities.rows,
    profileFrames: frames.rows,
    walletVsLastLedgerMismatchCount: Number(mismatch.rows[0]?.count || 0),
    testers: testerMatches
  }, null, 2));

  return testerMatches;
}

async function repairTesters(testerMatches) {
  const unresolved = TESTER_HANDLES.filter((handle) => testerMatches[handle].length !== 1);
  if (unresolved.length) {
    throw new Error(`Repair stopped: tester identity must resolve to exactly one active user: ${unresolved.join(', ')}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pivnik-v22-top-testers'))");

    const results = [];
    for (const handle of TESTER_HANDLES) {
      const userId = testerMatches[handle][0].userId;
      const inserted = await client.query(
        `INSERT INTO reward_grants (
           code, user_id, amount, source, achievement_code,
           achievement_period, reward_beer_ml
         ) VALUES ($1, $2::bigint, $3::bigint, 'achievement', $4, NULL, 0)
         ON CONFLICT (code, user_id) DO NOTHING
         RETURNING code`,
        [GRANT_CODE, userId, TESTER_REWARD, ACHIEVEMENT_CODE]
      );

      if (!inserted.rowCount) {
        results.push({ handle, userId, granted: false, reason: 'already_granted' });
        continue;
      }

      const wallet = await client.query(
        `UPDATE wallets SET balance=balance+$1::bigint, updated_at=NOW()
         WHERE user_id=$2::bigint RETURNING balance`,
        [TESTER_REWARD, userId]
      );
      if (!wallet.rowCount) throw new Error(`Wallet not found for ${handle}`);

      await client.query(
        `INSERT INTO transactions (
           request_key, client_id, mode, status, bonus_earned,
           balance_after, reason, reward_code, completed_at
         ) VALUES ($1, $2::bigint, 'achievement', 'completed', $3::bigint,
                   $4::bigint, $5, $6, NOW())`,
        [
          `achievement:${userId}:${ACHIEVEMENT_CODE}`,
          userId,
          TESTER_REWARD,
          wallet.rows[0].balance,
          'Достижение «Поднять щиты» — 750 бонусов',
          GRANT_CODE
        ]
      );
      results.push({ handle, userId, granted: true, amount: TESTER_REWARD, balanceAfter: Number(wallet.rows[0].balance) });
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ repair: 'completed', results }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

try {
  const testerMatches = await audit();
  if (!repairConfirmed) {
    console.log('Dry-run only. No production data was changed.');
  } else {
    await repairTesters(testerMatches);
  }
} finally {
  await pool.end();
}
