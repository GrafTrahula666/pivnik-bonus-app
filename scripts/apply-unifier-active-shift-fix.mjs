import { readFileSync, writeFileSync } from 'node:fs';

const target = new URL('./railway-unify-production-databases.mjs', import.meta.url);
let source = readFileSync(target, 'utf8');
let changed = false;

const activeShiftMarker = 'legacyActiveShiftsArchived';
if (!source.includes(activeShiftMarker)) {
  const oldDeclaration = `      const shiftMap = new Map();`;
  const newDeclaration = `      const shiftMap = new Map();
      let legacyActiveShiftsArchived = 0;`;

  const oldLoop = `      for (const row of snapshot.shifts || []) {
        const id = await insertRow(client, 'shifts', row, {
          exclude: ['id'],
          transform: { created_by: mappedId(userMap, row.created_by, 'shifts.created_by') },
          returning: 'id'
        });
        shiftMap.set(String(row.id), id);
      }`;

  const newLoop = `      const existingActiveShift = await client.query(
        'SELECT id FROM public.shifts WHERE ended_at IS NULL LIMIT 1'
      );
      let hasActiveShift = existingActiveShift.rowCount > 0;
      for (const row of snapshot.shifts || []) {
        const shiftRow = { ...row };
        if (shiftRow.ended_at === null && hasActiveShift) {
          const archivedAt = new Date();
          shiftRow.ended_at = archivedAt;
          shiftRow.updated_at = archivedAt;
          shiftRow.note = [
            String(shiftRow.note || '').trim(),
            'Архивировано при объединении VK → Telegram 2026-08-04'
          ].filter(Boolean).join(' · ');
          legacyActiveShiftsArchived += 1;
        }
        const id = await insertRow(client, 'shifts', shiftRow, {
          exclude: ['id'],
          transform: { created_by: mappedId(userMap, shiftRow.created_by, 'shifts.created_by') },
          returning: 'id'
        });
        if (shiftRow.ended_at === null) hasActiveShift = true;
        shiftMap.set(String(row.id), id);
      }`;

  const oldDetails = `        shifts: (snapshot.shifts || []).length,
        barCustomers: (snapshot.bar_customers || []).length,`;
  const newDetails = `        shifts: (snapshot.shifts || []).length,
        legacyActiveShiftsArchived,
        barCustomers: (snapshot.bar_customers || []).length,`;

  for (const [name, needle] of [
    ['shift declaration', oldDeclaration],
    ['shift migration loop', oldLoop],
    ['migration details', oldDetails]
  ]) {
    if (!source.includes(needle)) {
      throw new Error(`Could not find expected ${name} in railway unifier.`);
    }
  }

  source = source
    .replace(oldDeclaration, newDeclaration)
    .replace(oldLoop, newLoop)
    .replace(oldDetails, newDetails);
  changed = true;
} else if (!source.includes('Архивировано при объединении VK → Telegram 2026-08-04')) {
  throw new Error('Active-shift migration marker exists but archive logic is incomplete.');
}

const maintenanceMarker = 'setLegacyDatabaseReadOnly';
if (!source.includes(maintenanceMarker)) {
  const oldReadOnlyControl = `async function freezeLegacyDatabase(connectionString) {
  return withClient(connectionString, async (client) => {
    const databaseResult = await client.query('SELECT current_database() AS name');
    const databaseName = databaseResult.rows[0].name;
    await client.query(\`ALTER DATABASE \${quoteIdent(databaseName)} SET default_transaction_read_only TO on\`);
    await client.query(\`
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
    \`);
    return databaseName;
  });
}

async function unfreezeLegacyDatabase(connectionString) {
  return withClient(connectionString, async (client) => {
    const databaseResult = await client.query('SELECT current_database() AS name');
    const databaseName = databaseResult.rows[0].name;
    await client.query(\`ALTER DATABASE \${quoteIdent(databaseName)} RESET default_transaction_read_only\`);
    await client.query(\`
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
    \`);
  });
}`;

  const newReadOnlyControl = `async function setLegacyDatabaseReadOnly(connectionString, enabled) {
  const databaseName = new URL(connectionString).pathname.replace(/^\\//, '');
  if (!databaseName) throw new Error('Legacy database name is missing.');
  const maintenanceConnectionString = databaseUrlFor(connectionString, BACKUP_DATABASE_NAME);
  return withClient(maintenanceConnectionString, async (client) => {
    const command = enabled
      ? \`ALTER DATABASE \${quoteIdent(databaseName)} SET default_transaction_read_only TO on\`
      : \`ALTER DATABASE \${quoteIdent(databaseName)} RESET default_transaction_read_only\`;
    await client.query(command);
    await client.query(\`
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = $1
         AND pid <> pg_backend_pid()
    \`, [databaseName]);
    return databaseName;
  });
}

async function freezeLegacyDatabase(connectionString) {
  return setLegacyDatabaseReadOnly(connectionString, true);
}

async function unfreezeLegacyDatabase(connectionString) {
  await setLegacyDatabaseReadOnly(connectionString, false);
}`;

  if (!source.includes(oldReadOnlyControl)) {
    throw new Error('Could not find expected legacy database read-only control in railway unifier.');
  }
  source = source.replace(oldReadOnlyControl, newReadOnlyControl);
  changed = true;
}

if (changed) {
  writeFileSync(target, source, 'utf8');
  console.log('Pivnik cutover fixes applied and verified.');
} else {
  console.log('Pivnik cutover fixes are already applied.');
}
