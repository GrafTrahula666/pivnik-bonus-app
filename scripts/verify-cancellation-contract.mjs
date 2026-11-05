// Read-only git source verification. No merge, checkout, startup jobs or production requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { normalizeRequestKey } from '../platform-core.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const [clientRef, ownerRef, staffRef, browserPath] = process.argv.slice(2);
for (const ref of [clientRef, ownerRef, staffRef]) assert.match(ref || '', /^[a-f0-9]{40}$/, 'Pass pinned client, owner and staff commit SHAs');
const read = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 2e6 });
const base = await fs.readFile('server.js', 'utf8'), gateway = await fs.readFile('universal-server.js', 'utf8');
const client = read(clientRef, 'app.js'), owner = read(ownerRef, 'server.js'), staff = read(staffRef, 'server.js');
const between = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source anchors: ${start}`); return source.slice(a, b);
};
const rows = between(client, 'function staffRecentHtml(', 'async function loadStaffRecent(')
  + between(client, 'function adminTransactionHtml(', 'function inquiryStatusLabel(')
  + between(client, 'function filterAdminTransactions(', 'function adminUsersDirectoryParams(');
const apiSource = between(client, 'function timeoutError(', 'function openModal(');
const serialize = new Function('rubles', 'litersFromMl', between(base, 'function transactionResponse(', 'function publicLeaderboardName(') + '\nreturn transactionResponse;')(n => Number(n || 0) / 100, n => Number(n || 0) / 1000);
let active;
async function fixture(scope) {
  const db = new PGlite(); const controls = { profile: false, quota: false, refresh: false, notifications: 0, posts: 0 };
  for (const table of ['users', 'wallets', 'beer_loyalty', 'transactions', 'shifts', 'shift_members', 'cancel_quota_resets']) {
    const match = base.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`)); assert.ok(match); await db.exec(match[0]);
  }
  for (const sql of base.match(/ALTER TABLE (?:users ADD COLUMN IF NOT EXISTS (?:merged_into_user_id|unlimited_bonus|session_version|deleted_at)[^'\n]*|wallets ALTER COLUMN balance TYPE BIGINT|transactions (?:ALTER COLUMN (?:balance_after|bonus_spent|bonus_earned) TYPE BIGINT|ADD COLUMN IF NOT EXISTS (?:beer_ml|beer_gift_earned_ml|beer_gift_spent_ml|cancelled_by|cancelled_at|cancel_reason|cancel_request_key)[^'\n]*))/g)) await db.exec(sql);
  await db.exec(base.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_cancel_request_key[^'\n]*/)[0]);
  await db.exec(`INSERT INTO users (id, first_name, role) VALUES (10, 'Employee', 'staff'), (20, 'Client', 'client');
    INSERT INTO wallets (user_id, balance) VALUES (20, 100);
    INSERT INTO beer_loyalty (user_id, paid_ml_total, gift_ml_balance) VALUES (20, 1000, 700);
    INSERT INTO shifts (id, started_at, created_by) VALUES (1, '2000-01-01', 10);
    INSERT INTO shift_members (shift_id, user_id) VALUES (1, 10);`);
  const query = async (sql, values = []) => { const r = await db.query(sql, values); return { ...r, rowCount: r.rows.length || r.affectedRows || 0 }; };
  const pool = {
    async query(sql, values) { if (controls.quota && sql.includes('COUNT(*)::int')) throw Error('Fixture quota outage'); return query(sql, values); },
    async connect() { return { query, release() {} }; }
  };
  const getProfile = async id => {
    if (String(id) === '10') return { id: '10', role: scope === 'admin' ? 'admin' : 'staff' };
    if (controls.profile) throw Error('Fixture profile outage');
    return { id: String(id), telegramId: 'fixture', balance: Number((await query('SELECT balance FROM wallets WHERE user_id=$1', [id])).rows[0].balance), status: { bonusPercent: 5 } };
  };
  const getCurrentShift = async db => {
    const s = await db.query('SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'); if (!s.rowCount) return null;
    const m = await db.query('SELECT user_id AS id FROM shift_members WHERE shift_id=$1', [s.rows[0].id]);
    return { id: s.rows[0].id, startedAt: s.rows[0].started_at, members: m.rows };
  };
  const quotaSource = between(base, 'async function getCancellationQuota(', 'async function cancelCompletedTransaction(');
  const { quota, unlimited } = new Function('pool', 'getCurrentShift', 'STAFF_CANCEL_LIMIT', quotaSource + '\nreturn {quota:getCancellationQuota,unlimited:unlimitedCancellationQuota};')(pool, getCurrentShift, 3);
  const engine = new Function('isOwnerRow', 'UNLIMITED_BONUS_BALANCE', between(base, 'function hasUnlimitedBonus(', '// Anna frame entitlement')
    + between(base, 'async function lockRequestKey(', 'function signSession(')
    + between(base, 'async function cancelCompletedTransaction(', "app.get('/api/health'") + '\nreturn cancelCompletedTransaction;')(() => false, 999999999);
  const app = express(); app.use(express.json());
  const route = scope === 'staff' ? between(staff, "app.post('/api/staff/transactions/:id/cancel'", "app.get('/api/staff/transactions/:id'")
    : between(owner, "app.post('/api/admin/transactions/:id/cancel'", "app.post('/api/admin/users/:id/cancel-limit/reset'");
  app.use((req, res, next) => { if (req.method === 'POST') controls.posts++; next(); });
  new Function('app', 'pool', 'verifySession', 'getProfile', 'effectiveRoleForAuthenticatedIdentity', 'ownerTelegramId', 'ownerVkId',
    'normalizeRequestKey', 'resolveActingStaff', 'transactionResponse', 'unlimitedCancellationQuota', 'getCancellationQuota', 'cancelCompletedTransaction', 'sendTelegramMessage', 'console',
    between(base, 'async function authRequired(', 'async function resolveActingStaff(') + route)(app, pool,
    token => token ? { uid: '10', sv: 1, pid: token } : null, getProfile, (role, platform, pid) => pid, null, null,
    normalizeRequestKey, async req => req.user, serialize, unlimited, quota, engine, async () => { controls.notifications++; return { ok: false }; }, { error() {} });
  const history = async () => (await query(`SELECT t.*, 'Client' AS client_name, 'Employee' AS staff_name FROM transactions t ORDER BY id`)).rows.map(serialize);
  app.get('/api/staff/recent', async (req, res, next) => { try {
    if (controls.refresh) throw Error('Fixture refresh outage'); res.json({ transactions: await history(), quota: await quota('10') });
  } catch (error) { next(error); } });
  app.get('/api/admin/transactions', async (req, res, next) => { try {
    if (controls.refresh) throw Error('Fixture refresh outage'); res.json({ transactions: await history() });
  } catch (error) { next(error); } });
  app.use((error, req, res, next) => res.status(500).json({ error: 'Fixture server failure' }));
  return { app, controls, db, history, async seed() {
    controls.profile = controls.quota = controls.refresh = false;
    await query('DELETE FROM transactions'); await query('UPDATE wallets SET balance=100');
    await query('UPDATE beer_loyalty SET paid_ml_total=1000,gift_ml_balance=700');
    await query(`INSERT INTO transactions (id,request_key,client_id,staff_id,mode,bonus_earned,beer_ml,beer_gift_earned_ml)
      VALUES (30,'fixture-sale',20,10,'accrue',25,500,200)`);
  } };
}
const child = http.createServer((req, res) => active.app(req, res)); child.listen(0, '127.0.0.1'); await once(child, 'listening');
const proxy = new Function('http', 'internalPort', 'childReady', 'MAX_BODY_BYTES', 'canonicalizeSessionToken', between(gateway, 'async function readRequestBody(', 'export async function renderAppIndex(') + '\nreturn proxyRequest;')(
  http, child.address().port, true, 1e6, async token => ({ token, payload: {} }));
const root = process.cwd();
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return proxy(req, res);
  try {
    const name = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
    const file = path.resolve(root, name); assert.ok(file.startsWith(root + path.sep));
    res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
const evidence = [];
try {
  for (const width of [390, 1440]) for (const platform of ['telegram', 'vk']) for (const scope of ['staff', 'admin']) {
    active = await fixture(scope);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({ status: 204, body: '' });
      if (url.pathname.endsWith('.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      await route.continue();
    });
    page.on('dialog', dialog => dialog.accept('Fixture cancellation'));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page.evaluate(({ rows, apiSource, scope, platform }) => {
      document.documentElement.classList.add(`platform-${platform}`);
      document.querySelector('#bootScreen').classList.add('hidden'); const shell = document.querySelector('#appShell'); shell.classList.remove('hidden'); shell.classList.add('service-mode');
      document.querySelectorAll('.screen').forEach(node => node.classList.toggle('active', node.dataset.screen === scope));
      const state = { token: scope, profile: { role: scope }, staffRecent: [], adminTransactions: [], resolvedClient: { profile: { id: '20', balance: 100 } } };
      let render, key = 0;
      const api = new Function('state', 'APP_VERSION', 'IS_VK', 'API_TIMEOUT_MS', 'delay', apiSource + '\nreturn api;')(state, 'fixture', platform === 'vk', 3000, async () => {});
      const staffRefresh = async () => { const data = await api('/api/staff/recent'); render.renderStaffRecent(data); };
      const adminRefresh = async () => { const data = await api('/api/admin/transactions'); state.adminTransactions = data.transactions;
        render.renderAdminTransactions(state.adminTransactions); render.filterAdminTransactions(); };
      render = new Function('state', '$', 'api', 'requestId', 'toast', 'fmt', 'fmtLiters', 'escapeHtml', 'updateResolvedBeer', 'loadStaffRecent', 'loadAdmin', 'loadLeaderboard', 'openAllTransactions', 'roleCanWrite',
        rows + '\nreturn {renderStaffRecent,renderAdminTransactions,filterAdminTransactions};')(
        state, selector => document.querySelector(selector), api, () => `fixture-contract-key-${++key}`, text => {
          const node = document.querySelector('#toast'); node.textContent = text; node.classList.add('show');
        }, String, String, value => String(value || '').replace(/[&<>]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' })[char]), () => {}, staffRefresh, adminRefresh, async () => {}, adminRefresh, () => true);
      window.fixture = { state, api, render, refresh: scope === 'staff' ? staffRefresh : adminRefresh };
      if (scope === 'staff') document.querySelector('#reloadStaffRecent').onclick = staffRefresh;
      else document.querySelector('#adminTransactionsModal').classList.add('open');
    }, { rows, apiSource, scope, platform });
    await active.seed();
    for (const [token, expected] of [['', 401], ['viewer', 403]]) {
      const status = await page.evaluate(async ({ token, scope }) => {
        const old = fixture.state.token; fixture.state.token = token;
        try { await fixture.api(`/api/${scope}/transactions/30/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Fixture cancellation', requestKey: 'denial-contract-key' }) }); return 200; }
        catch (error) { return error.status; } finally { fixture.state.token = old; }
      }, { token, scope });
      assert.equal(status, expected);
    }
    const invalid = await page.evaluate(async scope => {
      try { await fixture.api(`/api/${scope}/transactions/30/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'x', requestKey: 'invalid-contract-key' }) }); return 200; }
      catch (error) { return error.status; }
    }, scope);
    assert.equal(invalid, 400);
    assert.equal(Number((await active.db.query('SELECT balance FROM wallets WHERE user_id=20')).rows[0].balance), 100);
    for (const failure of ['none', 'profile', ...(scope === 'staff' ? ['quota'] : [])]) {
      await active.seed(); await page.evaluate(() => fixture.refresh());
      active.controls.profile = failure === 'profile'; active.controls.quota = failure === 'quota'; active.controls.refresh = true;
      const selector = scope === 'staff' ? '#staffRecentOperations [data-staff-cancel]' : '#allTransactionsList [data-admin-cancel]';
      await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
      const before = active.controls.posts, notified = active.controls.notifications; await page.locator(selector).click();
      await page.waitForFunction(() => /Операция отменена.*не обновилась/.test(document.querySelector('#toast').textContent));
      assert.equal(await page.locator(selector).count(), 0);
      assert.equal(active.controls.posts - before, failure === 'none' ? 1 : 2, 'actual api retry count');
      const journal = await active.history(); assert.equal(journal[0].status, 'cancelled');
      assert.equal(journal[0].cancelledBy, '10'); assert.equal(journal[0].cancelReason, 'Fixture cancellation');
      assert.equal(active.controls.notifications - notified, failure === 'profile' ? 0 : 1);
      const beer = (await active.db.query('SELECT paid_ml_total,gift_ml_balance FROM beer_loyalty WHERE user_id=20')).rows[0];
      assert.deepEqual([Number(beer.paid_ml_total), Number(beer.gift_ml_balance)], [500, 500]);
      const wallet = (await active.db.query('SELECT balance FROM wallets WHERE user_id=20')).rows[0]; assert.equal(Number(wallet.balance), 75);
      assert.equal(await page.evaluate(() => fixture.state.adminTransactions.length ? fixture.state.adminTransactions[0].status : fixture.state.staffRecent[0].status), 'cancelled');
      if (scope === 'staff' && failure !== 'none') assert.match(await page.locator('#staffCancelQuota').textContent(), /Лимит отмен не обновлён/);
      active.controls.profile = active.controls.quota = active.controls.refresh = false;
      await page.evaluate(() => fixture.refresh());
      if (scope === 'staff') assert.match(await page.locator('#staffCancelQuota').textContent(), /осталось 2/);
      assert.equal(await page.locator(selector).count(), 0);
      evidence.push({ scope, width, platform, failure, savedBalance: 75, repeatedRefund: false, refreshRecovered: true });
    }
    const key = (await active.db.query('SELECT cancel_request_key FROM transactions WHERE id=30')).rows[0].cancel_request_key;
    const conflict = await page.evaluate(async ({ scope, key }) => {
      try { await fixture.api(`/api/${scope}/transactions/30/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Different reason', requestKey: key }) }); return 200; }
      catch (error) { return error.status; }
    }, { scope, key });
    assert.equal(conflict, 409);
    assert.equal(Number((await active.db.query('SELECT balance FROM wallets WHERE user_id=20')).rows[0].balance), 75);
    await active.seed(); await page.evaluate(() => fixture.refresh());
    await active.db.exec("ALTER TABLE transactions ADD CONSTRAINT fixture_cancel_failure CHECK (status <> 'cancelled')");
    const failed = await page.evaluate(async scope => {
      try { await fixture.api(`/api/${scope}/transactions/30/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Fixture cancellation', requestKey: 'rollback-contract-key' }) }); return 200; }
      catch (error) { return error.status; }
    }, scope);
    assert.equal(failed, 500);
    assert.equal(Number((await active.db.query('SELECT balance FROM wallets WHERE user_id=20')).rows[0].balance), 100);
    assert.equal((await active.history())[0].status, 'completed');
    await page.close(); await active.db.close(); active = null;
  }
  console.log(JSON.stringify({ refs: { clientRef, ownerRef, staffRef }, scenarios: evidence }, null, 2));
} finally { if (active) await active.db.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => child.close(resolve)); }
