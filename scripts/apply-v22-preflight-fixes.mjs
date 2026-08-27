import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');
let source = await fs.readFile(gatewayPath, 'utf8');

const telegramOnlyGuard = `      if (platform !== 'telegram') {
        return sendJson(res, 404, { error: 'Колесо доступно только в Telegram.' });
      }
`;

let removed = 0;
while (source.includes(telegramOnlyGuard)) {
  source = source.replace(telegramOnlyGuard, '');
  removed += 1;
}

if (removed !== 0 && removed !== 2) {
  throw new Error(`v22 preflight: ожидалось 0 или 2 Telegram-only wheel guard, найдено ${removed}`);
}
if (source.includes('Колесо доступно только в Telegram.')) {
  throw new Error('v22 preflight: Telegram-only wheel guard остался в gateway');
}

const multilineDiamondFrame = `  if (row?.owns_diamond_frame || String(row?.profile_frame || '') === 'diamond') {
    frames.push({ code: 'diamond', title: 'Алмазная рамка' });
  }
  return frames;`;
const normalizedDiamondFrame = `  if (row?.owns_diamond_frame || String(row?.profile_frame || '') === 'diamond') frames.push({ code: 'diamond', title: 'Алмазная рамка' });
  return frames;`;
if (source.includes(multilineDiamondFrame)) {
  source = source.replace(multilineDiamondFrame, normalizedDiamondFrame);
}

await fs.writeFile(gatewayPath, source, 'utf8');
console.log(`Pivnik v22 preflight ready; removed ${removed} Telegram-only wheel guards.`);
