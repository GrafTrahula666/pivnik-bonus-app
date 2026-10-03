// Manual isolated browser/HTTP/SQL verification. Never starts the production app.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { normalizeRequestKey } from '../platform-core.js';
import { createAdminAdjustmentPersistence } from '../admin-adjustment-persistence.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = process.cwd(), out = path.join(root, 'artifacts', 'admin-adjustment-contract');
await fs.mkdir(out, { recursive: true });
const source = await fs.readFile('server.js', 'utf8');
const client = await fs.readFile('app.js', 'utf8');
const gateway = await fs.readFile('universal-server.js', 'utf8');
const fixtureSource = await fs.readFile('test/admin-adjustment-ui-recovery.integration.test.js', 'utf8');
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source anchors: ${start}`);
  return text.slice(a, b);
}
// Reuse the existing SQL test fixture without importing it or registering tests.
const createFixture = new Function('source', 'assert', 'express', 'PGlite', 'once', 'normalizeRequestKey', 'createAdminAdjustmentPersistence',
  between(fixtureSource, 'function between(', 'const clientSource =') + '\nreturn harness;')(
  source, assert, express, PGlite, once, normalizeRequestKey, createAdminAdjustmentPersistence);
const cleanup = [];
const h = await createFixture({ after: fn => cleanup.push(fn) });
const transport = { mode: 'normal', posts: [], drops: 0, savedReplies: [] };
const proxy = new Function('http', 'internalPort', 'childReady', 'MAX_BODY_BYTES', 'canonicalizeSessionToken',
  between(gateway, 'async function readRequestBody(', 'export async function renderAppIndex(') + '\nreturn {proxyRequest,readRequestBody};')(
  http, Number(new URL(h.baseUrl).port), true, 1e6, async token => ({ token, payload: {} }));
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const body = await proxy.readRequestBody(req);
      transport.posts.push({ body: JSON.parse(body), platform: req.headers['x-pivnik-platform'], authorization: req.headers.authorization });
      if (transport.mode === 'unavailable') {
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Isolated transport unavailable before upstream' }));
      }
      if (transport.mode === 'drop') {
        transport.mode = 'normal';
        const chunks = [];
        // Consume the real proxy's full upstream reply, then close the browser
        // socket after headers and a partial body. SQL has already COMMITted.
        // Sending headers prevents Chromium from transparently replaying a
        // request whose socket closes before any response bytes arrive.
        const sink = new Writable({
          write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) {
            transport.savedReplies.push({ status: sink.status, body: JSON.parse(Buffer.concat(chunks).toString()) });
            transport.drops++;
            res.writeHead(sink.status, sink.responseHeaders); res.flushHeaders();
            res.write('{'); setTimeout(() => res.destroy(), 20); done();
          }
        });
        sink.writeHead = (status, headers) => { sink.status = status; sink.responseHeaders = headers; };
        return await proxy.proxyRequest(req, sink, body);
      }
      return await proxy.proxyRequest(req, res, body);
    }
    const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
    const file = path.resolve(root, name); assert.ok(file.startsWith(root + path.sep));
    res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
    res.end(await fs.readFile(file));
  } catch (error) { if (!res.destroyed) { res.writeHead(500); res.end(String(error)); } }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ headless: true, ...(process.argv[2] ? { executablePath: process.argv[2] } : {}) });
const apiSource = between(client, 'function timeoutError(', 'function openModal(');
const uiSource = between(client, 'function adminCrmActivityMarkup(', "$('#openProfileSettings')");
const results = [];
try {
  for (const width of [390, 1440]) for (const platform of ['vk', 'telegram']) for (const amount of [25, -25]) for (const failure of ['socket-loss', 'journal-write']) {
    await h.db.exec('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS fixture_adjust_write_failure; DELETE FROM transactions; UPDATE wallets SET balance=100');
    const baseline = await h.snapshot();
    // Isolated database fault: UPDATE succeeds, but journal INSERT must fail.
    if (failure === 'journal-write') await h.db.exec("ALTER TABLE transactions ADD CONSTRAINT fixture_adjust_write_failure CHECK (mode <> 'adjustment')");
    transport.posts = []; transport.drops = 0; transport.savedReplies = []; transport.mode = failure === 'socket-loss' ? 'drop' : 'normal';
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    const page = await context.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({ status: 204, body: '' });
      if (url.pathname.endsWith('.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      return route.continue();
    });
    let dialogs = 0; const statuses = [];
    page.on('response', response => { if (response.url().endsWith('/api/admin/users/20/adjust')) statuses.push(response.status()); });
    page.on('dialog', dialog => { dialogs++; return dialog.accept(dialog.type() === 'confirm' ? undefined : dialog.message().startsWith('Изменение') ? String(amount) : 'Fixture correction'); });
    const mount = async () => page.evaluate(({ apiSource, uiSource, platform, amount }) => {
      document.documentElement.classList.add(`platform-${platform}`);
      document.querySelector('#bootScreen')?.classList.add('hidden');
      const modal = document.querySelector('#adminUsersModal'); modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
      const state = { token: '10', profile: { id: '10', role: 'admin' } };
      const api = new Function('state', 'APP_VERSION', 'IS_VK', 'API_TIMEOUT_MS', 'delay', apiSource + '\nreturn api;')(
        state, 'isolated-recovery', platform === 'vk', 3000, ms => new Promise(resolve => setTimeout(resolve, ms)));
      const fixture = { state, api, messages: [], keys: 0 };
      const wire = new Function('state', '$', '$$', 'api', 'IS_VK', 'prompt', 'requestId', 'toast', 'refreshAdminUsersDirectory',
        'fmt', 'fmtLiters', 'escapeHtml', 'compactBonus', 'roleCanWrite', 'ADMIN_CRM_STATUS_LABELS', uiSource + '\nreturn {renderUsers,adjustAdminBonus};');
      const handlers = wire(state, selector => document.querySelector(selector), selector => [...document.querySelectorAll(selector)], api,
        platform === 'vk', window.prompt.bind(window), () => `contract-${platform}-${amount}-${++fixture.keys}`, text => {
          fixture.messages.push(text); const node = document.querySelector('#toast'); node.textContent = text; node.classList.add('show');
        }, async () => { throw Error('Isolated directory read outage'); }, String, String,
        value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
        String, role => role === 'admin', {});
      handlers.renderUsers([{ id: '20', name: 'Тестовый клиент', role: 'client', balance: 100, crmStatus: 'active', telegramId: '123', beerPaidLitersTotal: 0, beerGiftLitersBalance: 0 }], '#allUsersList');
      window.fixture = fixture;
    }, { apiSource, uiSource, platform, amount });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' }); await mount();
    await page.locator('[data-adjust-user]').click();
    await page.waitForFunction(() => fixture.messages.length > 0);
    assert.match(await page.locator('#toast').textContent(), /не подтверждён/);
    assert.equal(transport.posts.length, 1);
    const beforeRecovery = await h.snapshot();
    if (failure === 'socket-loss') {
      assert.equal(transport.drops, 1);
      assert.equal(transport.savedReplies[0].status, 200); assert.equal(transport.savedReplies[0].body.ok, true);
      assert.equal(Number(beforeRecovery.wallets[0].balance), 100 + amount); assert.equal(beforeRecovery.journal.length, 1);
    } else {
      assert.equal(transport.drops, 0); assert.deepEqual(statuses, [500]);
      assert.deepEqual(beforeRecovery, baseline, 'Journal INSERT failure must roll back the wallet UPDATE');
      await h.db.exec('ALTER TABLE transactions DROP CONSTRAINT fixture_adjust_write_failure');
    }
    await page.reload({ waitUntil: 'networkidle' }); await mount();
    assert.equal(await page.locator('[data-adjust-user]').textContent(), 'Повторить');
    await page.screenshot({ animations: 'disabled', path: path.join(out, `${platform}-${width}-${amount}-${failure}-reload.png`) });
    // A stale owner UI must still be denied by the real role middleware.
    await page.evaluate(() => { fixture.state.token = '12'; fixture.messages = []; });
    await page.locator('[data-adjust-user]').click(); await page.waitForFunction(() => fixture.messages.length > 0);
    assert.match(await page.locator('#toast').textContent(), /не подтверждён/);
    assert.match(await page.locator('#toast').textContent(), /Нет доступа.*Исходный ключ сохранён/);
    await page.screenshot({ animations: 'disabled', path: path.join(out, `${platform}-${width}-${amount}-${failure}-denied.png`) });
    assert.deepEqual(await h.snapshot(), beforeRecovery);
    assert.equal(await page.locator('[data-adjust-user]').textContent(), 'Повторить');
    await page.evaluate(() => { fixture.state.token = '10'; fixture.messages = []; });
    await page.locator('[data-adjust-user]').click(); await page.waitForFunction(() => fixture.messages.length > 0);
    assert.match(await page.locator('#toast').textContent(), /Корректировка сохранена.*Список не обновился/);
    const recovered = await h.snapshot();
    assert.equal(Number(recovered.wallets[0].balance), 100 + amount); assert.equal(recovered.journal.length, 1);
    assert.equal(String(recovered.journal[0].staff_id), '10');
    assert.equal(recovered.journal[0].reason, 'Fixture correction');
    assert.equal(recovered.journal[0].request_key, transport.posts[0].body.requestKey);
    if (failure === 'socket-loss') assert.deepEqual(recovered, beforeRecovery);
    assert.equal(transport.posts.length, 3);
    for (const post of transport.posts) { assert.deepEqual(post.body, transport.posts[0].body); assert.equal(post.platform, platform); }
    assert.equal(await page.evaluate(() => fixture.keys), 0); assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    assert.equal(dialogs, 4); assert.equal(await page.locator('[data-adjust-user]').textContent(), 'Баланс');
    // Direct client api denials/invalid input/conflicts through actual proxy.
    for (const [token, body, status] of [
      ['', transport.posts[0].body, 401], ['12', transport.posts[0].body, 403],
      ['10', { ...transport.posts[0].body, requestKey: 'invalid-zero-key', amount: 0 }, 400],
      ['10', { ...transport.posts[0].body, amount: amount + 1 }, 409]
    ]) {
      const actual = await page.evaluate(async ({ token, body }) => {
        fixture.state.token = token;
        try { await fixture.api('/api/admin/users/20/adjust', { method: 'POST', retries: 0, body: JSON.stringify(body) }); return 200; }
        catch (error) { return error.status; }
      }, { token, body });
      assert.equal(actual, status); assert.deepEqual(await h.snapshot(), recovered);
    }
    transport.mode = 'unavailable';
    const external = await page.evaluate(async () => {
      fixture.state.token = '10';
      try { await fixture.api('/api/admin/users/20/adjust', { method: 'POST', retries: 0, body: JSON.stringify({ amount: 1, reason: 'Fixture correction', requestKey: 'external-failure-key' }) }); return 200; }
      catch (error) { return error.status; }
    });
    assert.equal(external, 502); assert.deepEqual(await h.snapshot(), recovered); transport.mode = 'normal';
    assert.equal(h.connections, h.releases);
    const box = await page.locator('#allUsersList').boundingBox(); assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1);
    results.push({ platform, width, amount, failure, initialBalance: Number(beforeRecovery.wallets[0].balance), savedBalance: 100 + amount, journalRollback: failure === 'journal-write', postCommitSocketDrop: failure === 'socket-loss', reloadRecovery: true, journalEntries: 1, denialChecks: 5 });
    await context.close();
  }
  console.log(JSON.stringify({ scenarios: results.length, denialChecks: results.length * 5, results }, null, 2));
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  for (const fn of cleanup.reverse()) await fn();
}
