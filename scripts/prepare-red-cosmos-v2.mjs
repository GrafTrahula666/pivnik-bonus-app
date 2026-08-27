import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.js');
let source = await fs.readFile(serverPath, 'utf8');

const cashPriceAnchor = '    await client.query("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS cash_price INTEGER NOT NULL DEFAULT 0");';

if (!source.includes(cashPriceAnchor)) {
  const betaGrantsAnchor = `    await client.query(\`
      CREATE TABLE IF NOT EXISTS beta_grants (`;
  if (!source.includes(betaGrantsAnchor)) {
    throw new Error('RED COSMOS v2 prepare: beta_grants anchor not found after base materialization');
  }

  const compatibilityColumns = `    // RED_COSMOS_V2_MATERIALIZED_SHOP_COMPAT
    await client.query("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other'");
    await client.query("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS price_type TEXT NOT NULL DEFAULT 'bonus'");
    await client.query("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS cash_price INTEGER NOT NULL DEFAULT 0");
`;
  source = source.replace(betaGrantsAnchor, `${compatibilityColumns}${betaGrantsAnchor}`);
}

if (!source.includes(cashPriceAnchor)) {
  throw new Error('RED COSMOS v2 prepare: shop compatibility columns were not materialized');
}

await fs.writeFile(serverPath, source, 'utf8');
console.log('RED COSMOS v2 base materialization normalized.');
