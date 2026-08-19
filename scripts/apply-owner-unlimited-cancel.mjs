import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.js');
const marker = '// V21 · owner unlimited cancellation';

let source = await fs.readFile(serverPath, 'utf8');
if (source.includes(marker)) {
  console.log('Owner unlimited cancellation already applied.');
  process.exit(0);
}

const helperAnchor = 'async function cancelCompletedTransaction(db, transactionId, actorId, reason, requestKey, options = {}) {';
if (!source.includes(helperAnchor)) throw new Error('Cancellation helper anchor not found.');
source = source.replace(
  helperAnchor,
  `function unlimitedCancellationQuota() {\n  return {\n    active: true,\n    unlimited: true,\n    limit: null,\n    used: 0,\n    remaining: null,\n    shiftId: null,\n    countFrom: null\n  };\n}\n\n${helperAnchor}`
);

const routeStart = "app.post('/api/staff/transactions/:id/cancel', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {";
const routeEnd = "app.get('/api/staff/transactions/:id', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {";
const start = source.indexOf(routeStart);
const end = source.indexOf(routeEnd, start);
if (start < 0 || end < 0) throw new Error('Staff cancellation route not found.');

let route = source.slice(start, end);
const actingAnchor = "  const actingStaff = await resolveActingStaff(req);\n  if (!actingStaff) return res.status(401).json({ error: 'Сессия сотрудника истекла. Введите PIN снова.' });";
if (!route.includes(actingAnchor)) throw new Error('Acting staff anchor not found in cancellation route.');
route = route.replace(
  actingAnchor,
  `${actingAnchor}\n  ${marker}\n  const ownerUnlimitedCancel = actingStaff.role === 'admin';`
);

route = route.replaceAll(
  'quota: await getCancellationQuota(actingStaff.id)',
  'quota: ownerUnlimitedCancel ? unlimitedCancellationQuota() : await getCancellationQuota(actingStaff.id)'
);

const quotaBlock = `    const quota = await getCancellationQuota(actingStaff.id, client);\n    if (!quota.active) {\n      await client.query('ROLLBACK');\n      return res.status(403).json({ error: 'Отмена доступна только в активной смене.' });\n    }\n    if (quota.remaining <= 0) {\n      await client.query('ROLLBACK');\n      return res.status(403).json({ error: 'Лимит отмен исчерпан. Следующую отмену проводит владелец.' });\n    }`;
const quotaReplacement = `    const quota = ownerUnlimitedCancel\n      ? unlimitedCancellationQuota()\n      : await getCancellationQuota(actingStaff.id, client);\n    if (!ownerUnlimitedCancel && !quota.active) {\n      await client.query('ROLLBACK');\n      return res.status(403).json({ error: 'Отмена доступна только в активной смене.' });\n    }\n    if (!ownerUnlimitedCancel && quota.remaining <= 0) {\n      await client.query('ROLLBACK');\n      return res.status(403).json({ error: 'Лимит отмен исчерпан. Следующую отмену проводит владелец.' });\n    }`;
if (!route.includes(quotaBlock)) throw new Error('Cancellation quota block not found.');
route = route.replace(quotaBlock, quotaReplacement);

const optionsBlock = '{ staffId: actingStaff.id, notBefore: quota.countFrom }';
if (!route.includes(optionsBlock)) throw new Error('Cancellation options block not found.');
route = route.replace(optionsBlock, "ownerUnlimitedCancel ? {} : { staffId: actingStaff.id, notBefore: quota.countFrom }");

source = source.slice(0, start) + route + source.slice(end);

const recentStart = "app.get('/api/staff/recent', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {";
const recentEnd = routeStart;
const rs = source.indexOf(recentStart);
const re = source.indexOf(recentEnd, rs);
if (rs >= 0 && re > rs) {
  let recent = source.slice(rs, re);
  recent = recent.replace(
    '    const quota = await getCancellationQuota(actingStaff.id);',
    "    const quota = actingStaff.role === 'admin' ? unlimitedCancellationQuota() : await getCancellationQuota(actingStaff.id);"
  );
  source = source.slice(0, rs) + recent + source.slice(re);
}

await fs.writeFile(serverPath, source, 'utf8');
console.log('Applied unlimited cancellation for owner/admin; staff limits remain unchanged.');
