import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
// Manual browser check; Playwright/Chromium must be supplied by the caller.
const { chromium } = createRequire(import.meta.url)('playwright');
const root = process.cwd(), out = path.join(root, 'artifacts', 'admin-adjustment-ui');
await fs.mkdir(out, { recursive: true });
const source = await fs.readFile('app.js', 'utf8');
const from = source.indexOf('function adminCrmActivityMarkup('), to = source.indexOf("$('#openProfileSettings')", from);
assert.ok(from >= 0 && to > from);
const client = source.slice(from, to);
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html');
    assert.ok(file.startsWith(root + path.sep));
    res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.argv[2] ? { executablePath: process.argv[2] } : {}) });
const results = [];
try {
  for (const width of [390, 1440]) for (const platform of ['vk', 'telegram']) {
    const context = await browser.newContext({ viewport: { width, height: 950 } }), page = await context.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({ status: 204, body: '' });
      if (url.pathname.endsWith('.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      return route.continue();
    });
    let input = '25';
    page.on('dialog', dialog => dialog.accept(dialog.type() === 'confirm' ? undefined : dialog.message().startsWith('Изменение') ? input : 'Fixture reason'));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page.evaluate(({ client, platform }) => {
      document.documentElement.classList.add(`platform-${platform}`);
      document.querySelector('#bootScreen')?.classList.add('hidden');
      const modal = document.querySelector('#adminUsersModal'); modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
      const state = { profile: { id: '10', role: 'admin' } };
      const fixture = { outcome: 'refresh-error', posts: 0, refreshes: 0, messages: [], commands: [], keys: 0 };
      const api = async (url, options) => {
        fixture.commands.push(JSON.parse(options.body));
        fixture.posts++; await new Promise(resolve => setTimeout(resolve, 150));
        if (fixture.outcome === 'denied') throw Object.assign(Error('Нет доступа'), { status: 403 });
        if (fixture.outcome === 'lost') throw Error('Lost response');
        if (fixture.outcome === 'error') throw Object.assign(Error('Ошибка 500'), { status: 500 });
        return { ok: true, balance: 125, replayed: fixture.outcome === 'replay' };
      };
      const refresh = async () => { fixture.refreshes++; if (fixture.outcome === 'refresh-error') throw Error('Read outage'); };
      const wire = new Function('state', '$', 'api', 'prompt', 'requestId', 'toast', 'refreshAdminUsersDirectory', 'fmt', 'fmtLiters',
        'escapeHtml', 'compactBonus', 'roleCanWrite', 'ADMIN_CRM_STATUS_LABELS', '$$', client + '\nreturn { renderUsers, adjustAdminBonus };');
      const handlers = wire(state, selector => document.querySelector(selector), api, window.prompt.bind(window), () => `fixture-key-${++fixture.keys}`,
        text => { fixture.messages.push(text); const node = document.querySelector('#toast'); node.textContent = text; node.classList.add('show'); },
        refresh, String, String, value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]), String, role => role === 'admin', {}, selector => [...document.querySelectorAll(selector)]);
      fixture.seed = (role = 'admin') => {
        state.profile.role = role; handlers.renderUsers([{ id: '20', name: 'Тестовый клиент', role: 'client', balance: 100,
          telegramId: '123', crmStatus: 'active', beerPaidLitersTotal: 0, beerGiftLitersBalance: 0 }], '#allUsersList');
      };
      fixture.handlers = handlers; window.fixture = fixture; fixture.seed();
    }, { client, platform });
    for (const outcome of ['success', 'refresh-error', 'denied', 'error', 'replay', 'lost', 'recover']) {
      await page.evaluate(outcome => { fixture.outcome = outcome; fixture.messages = []; fixture.seed(); }, outcome);
      await page.locator('[data-adjust-user]').click();
      await page.waitForFunction(() => fixture.messages.length > 0);
      const message = await page.locator('#toast').textContent();
      if (outcome === 'refresh-error') assert.match(message, /Корректировка сохранена.*125 Б.*не обновился/);
      else if (outcome === 'denied') assert.equal(message, 'Нет доступа');
      else if (['error', 'lost'].includes(outcome)) assert.match(message, /не подтверждён/);
      else assert.equal(message, 'Баланс изменён: 125 Б');
      assert.equal(await page.locator('[data-adjust-user]').isEnabled(), true);
      if (outcome === 'lost') await page.screenshot({ path: path.join(out, `${platform}-${width}-uncertain.png`) });
    }
    // The replay above resolves the original uncertain 500 command.
    const commands = await page.evaluate(() => fixture.commands);
    assert.deepEqual(commands[3], commands[4]);
    assert.deepEqual(commands[5], commands[6]);
    input = '1.9'; await page.locator('[data-adjust-user]').click();
    await page.waitForFunction(() => fixture.messages.at(-1).includes('ненулевое целое'));
    assert.equal(await page.evaluate(() => fixture.posts), 7);
    input = '25';
    await page.evaluate(() => { fixture.messages = []; fixture.outcome = 'success'; });
    await page.locator('[data-adjust-user]').click();
    assert.equal(await page.locator('[data-adjust-user]').isDisabled(), true);
    await page.evaluate(() => fixture.seed());
    assert.equal(await page.locator('[data-adjust-user]').isDisabled(), true);
    await page.evaluate(() => fixture.handlers.adjustAdminBonus(document.querySelector('[data-adjust-user]')));
    await page.waitForFunction(() => fixture.messages.length > 0);
    assert.equal(await page.evaluate(() => fixture.posts), 8);
    assert.equal(await page.locator('[data-adjust-user]').isEnabled(), true);
    await page.evaluate(() => fixture.seed('viewer'));
    assert.equal(await page.locator('[data-adjust-user]').count(), 0);
    await page.evaluate(() => fixture.seed());
    const box = await page.locator('#allUsersList').boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1);
    await page.screenshot({ path: path.join(out, `${platform}-${width}.png`) });
    results.push({ platform, width, scenarios: 10, posts: 8, noHorizontalOverflow: true });
    await context.close();
  }
  console.log(JSON.stringify(results));
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
