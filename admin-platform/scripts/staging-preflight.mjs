import pg from 'pg'

const { Client } = pg
const STAGING_PROJECT_ID = '472996fe-c85d-4bda-bb72-2c96f7e5030f'
const STAGING_SERVICE_ID = 'c9441ae5-7fe9-4030-9b61-3cd8238f94f3'
const INTEGRATION_DATABASE = 'codex_admin_test_staging'

function requireIsolatedStaging() {
  if (process.env.RAILWAY_PROJECT_ID !== STAGING_PROJECT_ID) {
    throw new Error('Staging preflight refused: unexpected Railway project.')
  }
  if (process.env.RAILWAY_SERVICE_ID !== STAGING_SERVICE_ID) {
    throw new Error('Staging preflight refused: unexpected Railway service.')
  }
  if (process.env.ADMIN_ALLOW_TEST_SEED !== 'true') {
    throw new Error('Staging preflight refused: ADMIN_ALLOW_TEST_SEED is not true.')
  }
  const raw = String(process.env.ADMIN_DATABASE_URL || '')
  if (!raw) throw new Error('ADMIN_DATABASE_URL is required.')
  const parsed = new URL(raw)
  if (!parsed.hostname.endsWith('.railway.internal')) {
    throw new Error('Staging preflight refused: database is not a Railway private service.')
  }
  return raw
}

const databaseUrl = requireIsolatedStaging()
const client = new Client({ connectionString: databaseUrl, ssl: false })

await client.connect()
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_staging_guard(
      project_id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO admin_staging_guard(project_id,service_id)
    VALUES('${STAGING_PROJECT_ID}','${STAGING_SERVICE_ID}')
    ON CONFLICT(project_id) DO UPDATE SET service_id=EXCLUDED.service_id;

    CREATE TABLE IF NOT EXISTS bars(
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT,
      username TEXT UNIQUE,
      photo_url TEXT,
      role TEXT NOT NULL DEFAULT 'client',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      merged_into_user_id BIGINT,
      deleted_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);
    CREATE TABLE IF NOT EXISTS bar_customers(
      bar_id BIGINT NOT NULL REFERENCES bars(id),
      user_id BIGINT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(bar_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS user_identities(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      provider_username TEXT,
      profile_url TEXT,
      UNIQUE(provider,provider_user_id)
    );
    CREATE TABLE IF NOT EXISTS wallets(
      user_id BIGINT PRIMARY KEY REFERENCES users(id),
      balance BIGINT NOT NULL DEFAULT 0 CHECK(balance>=0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS beer_loyalty(
      user_id BIGINT PRIMARY KEY REFERENCES users(id),
      paid_ml_total BIGINT NOT NULL DEFAULT 0,
      gift_ml_balance INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions(
      id BIGSERIAL PRIMARY KEY,
      request_key TEXT UNIQUE,
      client_id BIGINT REFERENCES users(id),
      staff_id BIGINT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      check_amount_cents BIGINT NOT NULL DEFAULT 0,
      discount_cents BIGINT NOT NULL DEFAULT 0,
      bonus_spent BIGINT NOT NULL DEFAULT 0,
      bonus_earned BIGINT NOT NULL DEFAULT 0,
      cash_paid_cents BIGINT NOT NULL DEFAULT 0,
      balance_after BIGINT,
      reason TEXT,
      reward_code TEXT,
      is_suspicious BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS reward_grants(
      code TEXT NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id),
      amount BIGINT NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      achievement_code TEXT,
      achievement_period TEXT,
      reward_beer_ml BIGINT NOT NULL DEFAULT 0,
      announced_at TIMESTAMPTZ,
      PRIMARY KEY(code,user_id)
    );
    CREATE TABLE IF NOT EXISTS user_achievements_v2(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      achievement_code TEXT NOT NULL,
      is_granted BOOLEAN NOT NULL DEFAULT FALSE,
      granted_at TIMESTAMPTZ,
      current_progress NUMERIC NOT NULL DEFAULT 0,
      required_progress NUMERIC NOT NULL DEFAULT 1,
      last_progress_check_at TIMESTAMPTZ,
      UNIQUE(user_id,achievement_code)
    );
    CREATE TABLE IF NOT EXISTS user_frames(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      frame_id TEXT NOT NULL,
      acquired_source TEXT,
      UNIQUE(user_id,frame_id)
    );
    CREATE TABLE IF NOT EXISTS wheel_spins(
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL DEFAULT 'free',
      prize_code TEXT,
      charged_bonus_cost BIGINT NOT NULL DEFAULT 0,
      bonus_awarded BIGINT NOT NULL DEFAULT 0,
      beer_awarded_ml INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shop_items(
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE,
      title TEXT,
      subtitle TEXT,
      category TEXT,
      price_type TEXT,
      bonus_price BIGINT NOT NULL DEFAULT 0,
      cash_price BIGINT NOT NULL DEFAULT 0,
      image_src TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shop_purchases(
      id BIGSERIAL PRIMARY KEY,
      request_key TEXT UNIQUE,
      user_id BIGINT NOT NULL REFERENCES users(id),
      item_code TEXT,
      bonus_price BIGINT NOT NULL DEFAULT 0,
      transaction_id BIGINT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS promotions(
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE,
      title TEXT,
      description TEXT,
      badge TEXT,
      image_src TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS app_settings(
      id INTEGER PRIMARY KEY,
      published JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  const bars = await client.query(`
    INSERT INTO bars(code,name,address)
    VALUES
      ('pivnik','ПИВНИК TEST VENUE','Тестовая улица, 1'),
      ('north-bar','NORTH BAR','Северный проспект, 10')
    ON CONFLICT(code) DO UPDATE
    SET name=EXCLUDED.name,address=EXCLUDED.address,active=TRUE,updated_at=NOW()
    RETURNING id::text,code
  `)
  const barIds = Object.fromEntries(bars.rows.map((row) => [row.code, row.id]))

  for (const tenant of [
    { code: 'pivnik', prefix: 'pivnik_test', first: 'Пивник', balance: 1200 },
    { code: 'north-bar', prefix: 'north_test', first: 'North', balance: 900 },
  ]) {
    for (let index = 1; index <= 8; index += 1) {
      const username = `${tenant.prefix}_${index}`
      const user = await client.query(`
        INSERT INTO users(first_name,last_name,username,created_at)
        VALUES($1,$2,$3,NOW()-($4::text||' days')::interval)
        ON CONFLICT(username) DO UPDATE SET first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name
        RETURNING id::text
      `, [tenant.first, `Клиент ${index}`, username, index * 3])
      const userId = user.rows[0].id
      await client.query(`INSERT INTO bar_customers(bar_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [barIds[tenant.code], userId])
      await client.query(`INSERT INTO wallets(user_id,balance) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING`, [userId, tenant.balance + index * 125])
      await client.query(`INSERT INTO beer_loyalty(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, [userId])
      await client.query(`
        INSERT INTO user_identities(user_id,provider,provider_user_id,provider_username)
        VALUES($1,$2,$3,$4) ON CONFLICT(provider,provider_user_id) DO NOTHING
      `, [userId, index % 2 ? 'telegram' : 'vk', `${tenant.prefix}-${index}`, username])
      await client.query(`
        INSERT INTO transactions(request_key,client_id,mode,status,check_amount_cents,cash_paid_cents,bonus_earned,balance_after,completed_at)
        VALUES($1,$2,'accrue','completed',$3,$3,$4,$5,NOW()-($6::text||' days')::interval)
        ON CONFLICT(request_key) DO NOTHING
      `, [`staging-${tenant.prefix}-${index}`, userId, 24000 + index * 6500, 75 + index * 15, tenant.balance + index * 125, index])
    }
  }

  const database = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [INTEGRATION_DATABASE])
  if (!database.rowCount) await client.query(`CREATE DATABASE ${INTEGRATION_DATABASE}`)
  console.log('STAGING_PREFLIGHT PASS: isolated legacy schema and synthetic customers are ready.')
} finally {
  await client.end()
}
