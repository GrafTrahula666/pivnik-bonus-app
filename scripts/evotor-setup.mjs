// Owner's one-off Evotor setup against the target DB, after a verified backup. Never runs on startup.
//   node scripts/evotor-setup.mjs --store <EVOTOR_STORE_ID> --admin <users.id>            (check only)
//   node scripts/evotor-setup.mjs --store <EVOTOR_STORE_ID> --admin <users.id> --migrate --apply
// --admin may be omitted when OWNER_TELEGRAM_ID is set. The till key is printed once.
import { parseArgs } from 'node:util';
import pg from 'pg';
import { applyEvotorMigrations, setupEvotorStore } from '../pos/setup.js';

const { values } = parseArgs({ options: {
  store: { type: 'string' }, admin: { type: 'string' }, device: { type: 'string' }, label: { type: 'string' },
  tenant: { type: 'string' }, location: { type: 'string' },
  migrate: { type: 'boolean' }, apply: { type: 'boolean' }, reissue: { type: 'boolean' }
} });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
  max: 1
});
try {
  if (values.migrate) {
    if (!values.apply) console.log('Миграции 012–014 будут применены только вместе с --apply.');
    else console.log('Применены миграции:', (await applyEvotorMigrations((sql) => pool.query(sql))).join(', '));
  }
  const result = await setupEvotorStore(pool, {
    storeId: values.store || process.env.EVOTOR_STORE_ID, adminUserId: values.admin,
    adminTelegramId: process.env.OWNER_TELEGRAM_ID, externalDeviceId: values.device, label: values.label,
    tenantId: values.tenant, locationId: values.location, apply: values.apply, reissue: values.reissue
  });
  const { deviceToken, ...report } = result;
  console.log(JSON.stringify(report, null, 2));
  if (!values.apply) console.log('Проверка пройдена. Для подключения запустите ту же команду с --apply.');
  else console.log(`\nКлюч кассы (показывается один раз, введите его в приложении PIVNIK на кассе):\n${deviceToken}`);
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
