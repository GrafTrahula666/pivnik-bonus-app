import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const compatibleStylesUrl = 'styles.css?v=17.3-vlad-poops&typography=18.0-readable-premium-type';

let index = await fs.readFile(indexPath, 'utf8');
const nextIndex = index.replace(/styles\.css\?v=[^"']+/g, compatibleStylesUrl);

if (nextIndex !== index) {
  index = nextIndex;
  await fs.writeFile(indexPath, index, 'utf8');
}

if (!index.includes(compatibleStylesUrl)) {
  throw new Error('Не удалось установить совместимую версию CSS для типографики.');
}

console.log('Typography cache version is compatible with release materialization.');
