import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = process.cwd();
const out = path.join(root, 'artifacts', 'cancellation-ui-browser-smoke');
await fs.mkdir(out, { recursive: true });
const source = await fs.readFile(path.join(root, 'app.js'), 'utf8');
const slice = (a, b) => {
  const from = source.indexOf(a), to = source.indexOf(b, from);
  assert.ok(from >= 0 && to > from); return source.slice(from, to);
};
const client = slice('function staffRecentHtml(', 'async function loadStaffRecent(')
  + slice('function adminTransactionHtml(', 'function inquiryStatusLabel(');
const mime = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
    const file = path.resolve(root, name); if (!file.startsWith(root + path.sep)) throw Error('invalid path');
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.argv[2] ? { executablePath: process.argv[2] } : {}) });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    for (const platform of ['vk', 'telegram']) for (const scope of ['staff', 'admin']) {
      const context = await browser.newContext({ viewport }); const page = await context.newPage();
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.fulfill({ status: 204, body: '' });
        if (url.pathname.endsWith('.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
        await route.continue();
      });
      page.on('dialog', dialog => dialog.accept('Fixture cancellation'));
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'networkidle' });
      await page.evaluate(({ client, scope, platform }) => {
        document.documentElement.classList.add(`platform-${platform}`);
        document.querySelector('#bootScreen')?.classList.add('hidden');
        document.querySelector('#appShell')?.classList.remove('hidden');
        document.querySelector('#appShell')?.classList.add('service-mode');
        document.querySelectorAll('.screen').forEach(node => node.classList.toggle('active', node.dataset.screen === scope));
        const tx = { id: '30', clientId: '20', status: 'completed', clientName: 'Тестовый клиент', staffName: 'Тестовый сотрудник',
          createdAt: '2026-10-03T10:00:00Z', mode: 'accrue', checkAmount: 500, bonusEarned: 25, bonusSpent: 0 };
        const state = { profile: { role: 'admin' }, staffRecent: [tx], adminTransactions: [tx], resolvedClient: { profile: { id: '20', balance: 100 } } };
        const fixture = { posts: 0, outcome: 'confirmed', refreshing: true, state };
        const api = async () => {
          fixture.posts++; await new Promise(resolve => setTimeout(resolve, 50));
          const transaction = { ...tx, status: 'cancelled', cancelReason: 'Fixture cancellation' };
          if (fixture.outcome === 'denied') throw Object.assign(new Error('Нет доступа'), { status: 403 });
          if (fixture.outcome === 'confirmed') throw Object.assign(new Error('Profile unavailable'), {
            status: 503, payload: { code: 'cancellation_committed', cancelled: true, transaction }
          });
          return { ok: true, transaction, quota: { active: true, used: 1, limit: 3, remaining: 2 } };
        };
        const refresh = async () => { if (fixture.refreshing) throw Error('Fixture read outage'); };
        const wire = new Function('state', '$', 'api', 'requestId', 'toast', 'fmt', 'fmtLiters', 'escapeHtml', 'updateResolvedBeer',
          'loadStaffRecent', 'loadAdmin', 'loadLeaderboard', 'openAllTransactions', 'filterAdminTransactions', 'roleCanWrite',
          client + '\nreturn { renderStaffRecent, renderAdminTransactions };');
        const render = wire(state, selector => document.querySelector(selector), api, () => 'fixture-key', text => {
          const node = document.querySelector('#toast'); node.textContent = text; node.classList.add('show');
        }, String, String, value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
        () => {}, refresh, refresh, refresh, refresh, () => {}, () => true);
        fixture.seed = () => {
          state.staffRecent = [{ ...tx }]; state.adminTransactions = [{ ...tx }];
          if (scope === 'staff') render.renderStaffRecent({ transactions: state.staffRecent, quota: { active: true, used: 0, limit: 3, remaining: 3 } });
          else render.renderAdminTransactions(state.adminTransactions);
        };
        window.fixture = fixture; fixture.seed();
      }, { client, scope, platform });
      const selector = scope === 'staff' ? '[data-staff-cancel]' : '[data-admin-cancel]';
      for (const outcome of ['denied', 'success', 'confirmed']) {
        await page.evaluate(outcome => { fixture.outcome = outcome; document.querySelector('#toast').textContent = ''; fixture.seed(); }, outcome);
        await page.locator(selector).click();
        await page.waitForFunction(() => /Нет доступа|Операция отменена.*не обновилась/.test(document.querySelector('#toast').textContent));
        if (outcome === 'denied') {
          assert.equal(await page.locator(selector).count(), 1);
          assert.equal(await page.locator(selector).isEnabled(), true);
          assert.equal(await page.locator('#toast').textContent(), 'Нет доступа');
        } else {
          assert.equal(await page.locator(selector).count(), 0);
          assert.equal(await page.evaluate(() => fixture.state.adminTransactions[0].status), 'cancelled');
          assert.match(await page.locator('#toast').textContent(), /Операция отменена.*не обновилась/);
          if (scope === 'staff' && outcome === 'confirmed') assert.match(await page.locator('#staffCancelQuota').textContent(), /Лимит отмен не обновлён/);
        }
      }
      const row = page.locator(scope === 'staff' ? '#staffRecentOperations' : '#adminOperations');
      await row.scrollIntoViewIfNeeded(); const box = await row.boundingBox();
      assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1, 'operation list horizontal overflow');
      assert.equal(await page.evaluate(() => fixture.posts), 3);
      await page.screenshot({ path: path.join(out, `${platform}-${scope}-${viewport.width}.png`) });
      results.push({ platform, scope, width: viewport.width, posts: 3, confirmed: true, horizontalOverflow: false });
      await context.close();
    }
  }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
