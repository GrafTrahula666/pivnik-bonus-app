import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.js');
let source = await fs.readFile(serverPath, 'utf8');

const importAnchor = "import { createAdminAdjustmentPersistence } from './admin-adjustment-persistence.js';\n";
const importLine = "import { createShopPurchasePersistence } from './shop-purchase-persistence.js';\n";
if (!source.includes(importLine)) {
  const count = source.split(importAnchor).length - 1;
  if (count !== 1) {
    throw new Error(`shop wiring: expected one admin persistence import anchor, received ${count}`);
  }
  source = source.replace(importAnchor, `${importAnchor}${importLine}`);
}

const routeStartMarker = "app.post('/api/staff/shop/purchase'";
const routeEndMarker = "app.get('/api/staff/recent'";
const routeStart = source.indexOf(routeStartMarker);
const routeEnd = source.indexOf(routeEndMarker, routeStart);
if (routeStart === -1 || routeEnd === -1) {
  throw new Error('shop wiring: route boundaries not found');
}

let route = source.slice(routeStart, routeEnd);
const legacyInsert = `    const txResult = await client.query(
      \`INSERT INTO transactions (request_key, client_id, staff_id, mode, status, bonus_spent, balance_after, reason, completed_at)
       VALUES ($1,$2,$3,'shop','completed',$4,$5,$6,NOW()) RETURNING *\`,
      [requestKey, target.id, actingStaff.id, item.bonusPrice, balanceAfter, item.title]
    );
`;
const wiredInsert = `    const persistShopPurchase = createShopPurchasePersistence({
      query: client.query.bind(client)
    });
    const shopTransaction = await persistShopPurchase({
      transaction: {
        request_key: requestKey,
        client_id: target.id,
        staff_id: actingStaff.id,
        mode: 'shop',
        status: 'completed',
        bonus_spent: item.bonusPrice,
        balance_after: balanceAfter,
        reason: item.title
      }
    });
`;

if (route.includes(legacyInsert)) {
  const count = route.split(legacyInsert).length - 1;
  if (count !== 1) throw new Error(`shop wiring: expected one legacy INSERT, received ${count}`);
  route = route.replace(legacyInsert, wiredInsert);
} else if (!route.includes(wiredInsert)) {
  throw new Error('shop wiring: expected legacy INSERT block not found');
}

const legacyResponse = 'res.json({ transaction: transactionResponse(txResult.rows[0]), client: await getProfile(target.id), item });';
const wiredResponse = 'res.json({ transaction: transactionResponse(shopTransaction), client: await getProfile(target.id), item });';
if (route.includes(legacyResponse)) {
  const count = route.split(legacyResponse).length - 1;
  if (count !== 1) throw new Error(`shop wiring: expected one legacy response use, received ${count}`);
  route = route.replace(legacyResponse, wiredResponse);
} else if (!route.includes(wiredResponse)) {
  throw new Error('shop wiring: expected legacy txResult response not found');
}

if (route.includes('INSERT INTO transactions') || route.includes('txResult.rows[0]')) {
  throw new Error('shop wiring: direct transaction persistence remains inside shop route');
}
if (!route.includes('createShopPurchasePersistence') || !route.includes('shopTransaction')) {
  throw new Error('shop wiring: postcondition failed');
}

source = `${source.slice(0, routeStart)}${route}${source.slice(routeEnd)}`;
await fs.writeFile(serverPath, source, 'utf8');
console.log('Shop purchase persistence boundary wired into canonical server.js.');
