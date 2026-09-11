import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.js');
let source = await fs.readFile(serverPath, 'utf8');

const importAnchor = "import { resolvePersonalQrRecord } from './qr-resolver.js';\n";
const importLine = "import { createAdminAdjustmentPersistence } from './admin-adjustment-persistence.js';\n";

if (!source.includes(importLine)) {
  const count = source.split(importAnchor).length - 1;
  if (count !== 1) {
    throw new Error(`admin-adjustment wiring: expected one qr-resolver import anchor, received ${count}`);
  }
  source = source.replace(importAnchor, `${importAnchor}${importLine}`);
}

const legacyBlock = `    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [newBalance, req.params.id]);
    await client.query(
      \`INSERT INTO transactions (
         request_key, client_id, staff_id, mode, status,
         bonus_spent, bonus_earned, balance_after, reason, completed_at
       ) VALUES ($1,$2,$3,'adjustment','completed',$4,$5,$6,$7,NOW())\`,
      [
        requestKey,
        req.params.id,
        req.user.id,
        amount < 0 ? Math.abs(amount) : 0,
        amount > 0 ? amount : 0,
        newBalance,
        reason
      ]
    );
`;

const wiredBlock = `    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [newBalance, req.params.id]);
    const persistAdjustment = createAdminAdjustmentPersistence({
      query: client.query.bind(client)
    });
    await persistAdjustment({
      transaction: {
        request_key: requestKey,
        client_id: req.params.id,
        staff_id: req.user.id,
        mode: 'adjustment',
        status: 'completed',
        bonus_spent: amount < 0 ? Math.abs(amount) : 0,
        bonus_earned: amount > 0 ? amount : 0,
        balance_after: newBalance,
        reason
      }
    });
`;

if (source.includes(legacyBlock)) {
  const count = source.split(legacyBlock).length - 1;
  if (count !== 1) {
    throw new Error(`admin-adjustment wiring: expected one legacy INSERT block, received ${count}`);
  }
  source = source.replace(legacyBlock, wiredBlock);
} else if (!source.includes(wiredBlock)) {
  throw new Error('admin-adjustment wiring: expected legacy INSERT block not found');
}

if (!source.includes(importLine) || !source.includes(wiredBlock)) {
  throw new Error('admin-adjustment wiring: postcondition failed');
}

await fs.writeFile(serverPath, source, 'utf8');
console.log('Admin adjustment persistence boundary wired into canonical server.js.');
