import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');
const marker = 'Separate platform profile refresh 2026-08-07';

let source = await fs.readFile(gatewayPath, 'utf8');
if (!source.includes(marker)) {
  const original = `      const shouldUpdateMainProfile = provider === 'telegram' || Number(identityCount.rows[0]?.count || 0) === 0;`;
  const replacement = `      // ${marker}. A standalone VK or Telegram identity owns its profile fields.
      // This also restores the surviving platform after one side of a legacy link is deleted.
      const identityCountValue = Number(identityCount.rows[0]?.count || 0);
      const shouldUpdateMainProfile = identityCountValue <= 1;`;
  if (!source.includes(original)) {
    throw new Error('Не найдено условие обновления платформенного профиля.');
  }
  source = source.replace(original, replacement);
}

if (!source.includes(marker) || !source.includes('const shouldUpdateMainProfile = identityCountValue <= 1;')) {
  throw new Error('Обновление профиля отдельной платформы не материализовано.');
}

await fs.writeFile(gatewayPath, source, 'utf8');
console.log('Separate platform profile refresh is applied and verified.');
