import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'server.js');
let source = await fs.readFile(file, 'utf8');

source = source.replace(
  /^\s*\{ code: 'frame-money-owner',[^\n]*\},\n?/m,
  ''
).replace(
  /^\s*\{ code: 'frame-fire-partner',[^\n]*\},\n?/m,
  ''
).replace(
  /^\s*\{ code: 'frame-diamond',[^\n]*\},\n?/m,
  ''
);

source = source.replace(
  "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond')",
  "DELETE FROM shop_items WHERE code IN ('frame-money-owner','frame-fire-partner','frame-diamond') OR category = 'profile'"
);

await fs.writeFile(file, source, 'utf8');

if (/category:\s*'profile'[\s\S]{0,180}active:\s*true/i.test(source)) {
  throw new Error('Активная цифровая позиция profile осталась в публичном каталоге.');
}
if (!source.includes("OR category = 'profile'")) {
  throw new Error('Не установлена очистка profile-категории из БД магазина.');
}

console.log('Public digital profile shop items removed.');
