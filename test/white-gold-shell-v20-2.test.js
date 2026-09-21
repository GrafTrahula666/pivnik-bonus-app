import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('white-gold v20.2 is the final canonical client shell', async () => {
  const [css, index, app] = await Promise.all([
    read('styles.css'),
    read('index.html'),
    read('app.js')
  ]);

  const marker = '/* SPACEVERSE WHITE-GOLD CANONICAL SHELL V20.2 */';
  const markerIndex = css.lastIndexOf(marker);
  assert.ok(markerIndex > 0, 'canonical white-gold shell marker must exist');
  const canonical = css.slice(markerIndex);

  assert.match(index, /styles\.css\?v=20\.2-spaceverse-white-gold-shell/);
  assert.match(index, /app\.js\?v=20\.2-spaceverse-white-gold-shell/);
  assert.match(canonical, /\.app-shell::before,[\s\S]*?display:\s*none\s*!important/);
  assert.doesNotMatch(canonical, /url\(/);
  assert.match(canonical, /\.bottom-nav[\s\S]*?repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(canonical, /\.achievement-tile\.earned\.rarity-epic/);
  assert.match(canonical, /screen\[data-screen="staff"\]/);
  assert.match(canonical, /screen\[data-screen="admin"\]/);

  const serviceAccess = index.indexOf('id="profileServiceAccess"');
  const history = index.indexOf('class="profile-history-card');
  assert.ok(serviceAccess > 0 && serviceAccess < history, 'role tools must be visible near the top of profile when authorized');

  assert.match(app, /profileStaffNav[\s\S]*?roleCanStaff/);
  assert.match(app, /profileAdminNav[\s\S]*?roleCanAdmin/);
});

test('canonical white-gold shell neutralizes legacy dark texture and rarity colors', async () => {
  const css = await read('styles.css');
  const canonical = css.slice(css.lastIndexOf('/* SPACEVERSE WHITE-GOLD CANONICAL SHELL V20.2 */'));

  assert.match(canonical, /background:\s*#f4efe7\s*!important/);
  assert.match(canonical, /\.achievement-tile\.earned\.rarity-rare,[\s\S]*?background:\s*rgba\(255,253,249,.96\)\s*!important/);
  assert.doesNotMatch(canonical, /#6f2330|#7542c9|rgba\(190,100,255|rgba\(74,153,255/);
});
