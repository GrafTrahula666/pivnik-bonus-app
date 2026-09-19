import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('SPACEVERSE V2 keeps ecosystem brand separate from venue identity', async () => {
  const [html, app, shell] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('scripts/apply-red-cosmos-v2-shell-final.mjs')
  ]);

  assert.match(html, /id="brandTitle">SPACEVERSE</);
  assert.match(html, /id="venueTitle">Пивник · программа лояльности/);
  assert.match(app, /#brandTitle'\)\.textContent = 'SPACEVERSE'/);
  assert.match(app, /#venueTitle/);
  assert.match(shell, /#brandTitle'\)\.textContent = 'SPACEVERSE'/);
  assert.match(shell, /#venueTitle/);
  assert.doesNotMatch(shell, /#brandTitle'\)\.textContent = design\.texts\?\.brand/);
});

test('SPACEVERSE V2 adds a business hub without expanding bottom navigation', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('app.js')]);

  assert.match(html, /id="openBusinessHub"/);
  assert.match(html, /data-screen="business"/);
  assert.match(html, /SPACEVERSE FOR BUSINESS/);
  assert.match(html, /Подключите приложение к своему бизнесу/);
  assert.match(html, /Начать можно бесплатно/);
  assert.match(html, /Лояльность/);
  assert.match(html, /CRM/);
  assert.match(html, /Аналитика/);
  assert.match(html, /Рассылки/);

  assert.match(app, /#openBusinessHub'\)\?\.addEventListener\('click', \(\) => switchScreen\('business'\)\)/);
  assert.match(app, /#businessBackButton'\)\?\.addEventListener\('click', \(\) => switchScreen\('client'\)\)/);

  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const targets = [...nav.matchAll(/data-target="/g)];
  assert.equal(targets.length, 4, 'bottom nav keeps four screen targets plus the central QR action');
  assert.match(nav, /id="navQrButton"/);
  assert.doesNotMatch(nav, /data-target="business"/);
});

test('SPACEVERSE V2 business visuals stay in the existing black-frosted surface layer', async () => {
  const [css, html] = await Promise.all([
    read('black-frosted-surfaces.css'),
    read('index.html')
  ]);

  assert.match(css, /SPACEVERSE V2: ecosystem identity \+ business hub/);
  assert.match(css, /\.spaceverse-business-banner/);
  assert.match(css, /\.spaceverse-business-cube/);
  assert.match(css, /\.spaceverse-business-feature-grid/);
  assert.doesNotMatch(html, /spaceverse-v2\.css/);
  assert.doesNotMatch(html, /business-hub\.css/);
});
