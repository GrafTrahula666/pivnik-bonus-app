import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => fs.readFile(path.join(root, name), 'utf8');

test('панель контента управляет только акциями и не показывает удалённый магазин', async () => {
  const [index, styles, app] = await Promise.all([
    source('index.html'),
    source('styles.css'),
    source('app.js')
  ]);
  const start = index.indexOf('<div class="card content-admin-card" id="contentAdminCard">');
  const end = index.indexOf('<div class="card admin-preview-card">', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const panel = index.slice(start, end);

  assert.match(panel, /<h3>Акции<\/h3>/);
  assert.match(panel, /id="addPromotion"/);
  assert.match(panel, /id="adminPromotionsList"/);
  assert.doesNotMatch(panel, /Акции и магазин|Добавить товар|id="addShopItem"|id="adminShopItemsList"|<b>Магазин<\/b>/);
  assert.match(index, /id="openContentAdminQuick"><span>Акции<\/span>/);
  assert.match(styles, /\.content-admin-columns \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(app, /\$\('#addShopItem'\)\?\.addEventListener/);
});
