import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'index.html');
let html = await fs.readFile(file, 'utf8');

if (html.includes('/legal/terms') && html.includes('/legal/privacy') && !html.includes('data-final-legal-links="1"')) {
  html = html.replace(
    /<div class="consent-legal-links"([^>]*)>/,
    '<div class="consent-legal-links"$1 data-final-legal-links="1">'
  );
}

await fs.writeFile(file, html, 'utf8');

if (!html.includes('/legal/terms') || !html.includes('/legal/privacy')) {
  throw new Error('Юридические ссылки отсутствуют перед финальным moderation-pass.');
}

console.log('Existing consent legal links marked for final moderation pass.');
