import { readFileSync, writeFileSync } from 'node:fs';

const target = new URL('./railway-unify-production-databases.mjs', import.meta.url);
let source = readFileSync(target, 'utf8');

const marker = 'legacyActiveShiftsArchived';
if (source.includes(marker)) {
  if (!source.includes('Архивировано при объединении VK → Telegram 2026-08-04')) {
    throw new Error('Active-shift migration marker exists but archive logic is incomplete.');
  }
  console.log('Pivnik active-shift cutover fix is already applied.');
  process.exit(0);
}

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

writeFileSync(target, source, 'utf8');
console.log('Pivnik active-shift cutover fix applied and verified.');
