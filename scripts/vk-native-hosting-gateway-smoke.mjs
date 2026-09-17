import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import QRCode from 'qrcode';

// Real HTTP origins, not route.fulfill: Chromium must enforce CORS itself.
// Match vk-api-gateway/server.mjs at 12a1fa0b, including its write guard.
const allowedHeaders = 'authorization,content-type,x-pivnik-version,x-pivnik-platform,x-pivnik-explicit-consent,x-staff-session';
const root = process.cwd();
const outDir = path.join(root, 'artifacts/vk-native-hosting-gateway-smoke');
const signed = 'vk_app_id=54694987&vk_user_id=4242&vk_ts=123456&vk_platform=mobile_iphone&sign=fixture-sign';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
let scenario;
let staticOrigin;
let gatewayOrigin;
const qrImage = await QRCode.toDataURL('pivnik-test-only:4242');

function wheelStatus() {
  return scenario.spinKey
    ? { freeAvailable: false, canAffordPaid: false, nextPaidCost: 50, balance: 5 }
    : { freeAvailable: true, nextFreeAt: null, balance: 321 };
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function payload() {
  return {
    token: 'fixture-session',
    profile: {
      id: '4242', firstName: 'Gateway Fixture', lastName: 'VK', provider: 'vk', role: scenario.role,
      termsAccepted: scenario.accepted, onboardingComplete: true, balance: scenario.spinKey ? 5 : 321,
      avatarSource: 'preset_male', photoUrl: '', profileFrame: 'none',
      status: { code: 'traveler', name: 'Путник', bonusPercent: 5 }, privacy: {}
    },
    statuses: [], design: null, promotions: [], shopItems: [], achievements: [], transactions: [],
    leaderboard: { entries: [], currentUser: null }
  };
}

const gateway = createServer(async (req, res) => {
  const pathname = new URL(req.url, gatewayOrigin).pathname;
  res.setHeader('access-control-allow-origin', staticOrigin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', allowedHeaders);
  if (req.method === 'OPTIONS') {
    scenario.preflights.push({ pathname, headers: req.headers['access-control-request-headers'] });
    res.writeHead(204); res.end(); return;
  }
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = text ? JSON.parse(text) : {};
  scenario.calls.push({ pathname, method: req.method, headers: req.headers, body });
  if (req.method === 'POST' && req.headers['x-pivnik-platform'] !== 'vk') {
    return json(res, { error: 'VK platform header is required.' }, 403);
  }
  if (pathname === '/api/me/consent') scenario.accepted = true;
  if (['/api/auth', '/api/bootstrap', '/api/me', '/api/me/consent'].includes(pathname)) return json(res, payload());
  if (pathname === '/api/achievements') return json(res, { achievements: [], earned: [], unannounced: [] });
  if (pathname === '/api/leaderboard/monthly') return json(res, { leaders: [], currentUser: null });
  if (pathname === '/api/shop/catalog') return json(res, { items: [] });
  if (pathname === '/api/shop/contact') return json(res, { ownerName: 'Fixture' });
  if (pathname === '/api/wallet/config') return json(res, { appleAvailable: false, googleAvailable: false, fallbackAvailable: true });
  if (pathname === '/api/shift/current') return json(res, { shift: null });
  if (pathname === '/api/promotions') return json(res, { promotions: [] });
  if (pathname === '/api/wheel/status') return json(res, wheelStatus());
  if (pathname === '/api/wheel/spin') {
    scenario.spinRequests.push(body.requestKey);
    if (!scenario.spinKey) scenario.spinKey = body.requestKey;
    assert.equal(body.requestKey, scenario.spinKey, 'a lost result must not create a second operation');
    // Commit once, then lose both automatic response attempts. The user must
    // recover the same operation after reload, despite insufficient funds.
    if (scenario.spinRequests.length <= 2) { res.destroy(); return; }
    return json(res, {
      spin: { prize: { code: 'bonus-5', title: '5 бонусов' } },
      status: wheelStatus(), idempotent: true,
      account: { balance: 5, unlimitedBonus: false, giftBeerLiters: 0 }
    });
  }
  if (pathname === '/api/me/qr') return json(res, { image: qrImage, shortCode: 'TEST4242' });
  if (pathname === '/api/staff/session') return json(res, { available: [], activeStaff: null });
  if (pathname === '/api/staff/recent') return json(res, { transactions: [] });
  if (pathname === '/api/diagnostics/vk-startup') return json(res, { ok: true });
  if (pathname === '/api/me/transactions') return json(res, { transactions: [] });
  scenario.unexpected.push(`${req.method} ${pathname}`);
  return json(res, { error: 'Unconfigured fixture endpoint' }, 404);
});

const staticServer = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, staticOrigin).pathname;
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/vendor/vk-bridge.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`window.vkBridge={send:async(method)=>{
        if(method==='VKWebAppGetUserInfo'){await new Promise(r=>setTimeout(r,1200));return {id:4242,first_name:'Gateway',last_name:'Fixture'};}
        if(method==='VKWebAppGetLaunchParams')return Object.fromEntries(new URLSearchParams(${JSON.stringify(signed)}));
        return {};
      }};`);
      return;
    }
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
    if (relative.split('/').includes('..')) throw new Error('invalid path');
    let bytes = await fs.readFile(path.join(root, 'vk-hosting-build', relative));
    if (relative === 'index.html') {
      bytes = bytes.toString().replace(/window\.__PIVNIK_VK_API_BASE__=[^;]+;/, `window.__PIVNIK_VK_API_BASE__=${JSON.stringify(gatewayOrigin)};`);
    }
    res.writeHead(200, { 'content-type': mime[path.extname(relative)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});

await fs.mkdir(outDir, { recursive: true });
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
gatewayOrigin = `http://127.0.0.1:${gateway.address().port}`;
await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
staticOrigin = `http://127.0.0.1:${staticServer.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const role of ['client', 'admin', 'staff']) {
    scenario = { role, accepted: role !== 'client', calls: [], preflights: [], unexpected: [], spinRequests: [] };
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      const expectedDrop = message.location().url === `${gatewayOrigin}/api/wheel/spin`
        && message.text().includes('ERR_EMPTY_RESPONSE');
      if (message.type() === 'error' && !expectedDrop) errors.push(message.text());
    });
    await page.goto(`${staticOrigin}/index.html?${signed}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#appShell').waitFor({ state: 'visible', timeout: 12000 });
    if (!scenario.accepted) {
      await page.locator('#acceptTerms').click();
      await page.locator('#consentModal').waitFor({ state: 'hidden' });
      assert.ok(scenario.calls.some(({ pathname }) => pathname === '/api/me/consent'));
    }
    await page.waitForFunction(() => window.__PIVNIK_VK_PROFILE_HYDRATION__?.profile?.id === '4242');
    assert.ok(scenario.calls.some(({ pathname, body }) => pathname === '/api/auth' && body.user?.id === 4242), 'delayed hydration must pass the real gateway write guard');
    await page.locator('.bottom-nav [data-target="profile"]').click();
    assert.equal(await page.locator('#profileAdminNav').isVisible(), role === 'admin');
    assert.equal(await page.locator('#profileStaffNav').isVisible(), role !== 'client');
    await page.locator('.bottom-nav [data-target="league"]').click();
    await page.locator('[data-screen="league"]').waitFor({ state: 'visible' });
    await page.locator('.bottom-nav [data-target="client"]').click();
    await page.locator('#navQrButton').click();
    await page.waitForFunction(() => document.querySelector('#qrImage')?.naturalWidth > 0);
    assert.equal(await page.locator('#qrToken').textContent(), 'TEST4242');
    await page.locator('[data-close="qrModal"]').click();
    await page.locator('#openShopButton').click();
    await page.locator('#shopModal').waitFor({ state: 'visible' });
    await page.locator('[data-close="shopModal"]').click();
    await page.locator('#openWheelButton').click();
    await page.locator('[data-screen="wheel"]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#wheelSpinButton').isEnabled(), true);
    if (role === 'client') {
      await page.locator('#wheelSpinButton').click();
      await page.getByRole('button', { name: 'Проверить результат', exact: true }).waitFor({ state: 'visible' }).catch(async (error) => {
        console.error(JSON.stringify({ spinRequests: scenario.spinRequests, errors,
          calls: scenario.calls.map(({ method, pathname }) => `${method} ${pathname}`),
          button: await page.locator('#wheelSpinButton').textContent(),
          result: await page.locator('#wheelResult').textContent() }));
        throw error;
      });
      assert.equal(scenario.spinRequests.length, 2);
    }
    // Reload must use the stored session and preserve permissions.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#appShell').waitFor({ state: 'visible' });
    if (role === 'client') {
      await page.locator('#openWheelButton').click();
      await page.getByRole('button', { name: 'Проверить результат', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#wheelResultTitle')?.textContent === '5 бонусов');
      assert.equal(scenario.spinRequests.length, 3);
      assert.equal(new Set(scenario.spinRequests).size, 1);
      await page.locator('#wheelBackButton').click();
    }
    await page.locator('.bottom-nav [data-target="profile"]').click();
    assert.equal(await page.locator('#profileAdminNav').isVisible(), role === 'admin');
    assert.equal(await page.locator('#profileStaffNav').isVisible(), role !== 'client');
    assert.ok(scenario.calls.some(({ pathname }) => pathname === '/api/bootstrap'));
    assert.ok(scenario.preflights.some(({ pathname }) => pathname === '/api/auth'));
    assert.ok(scenario.calls.some(({ pathname, body }) => pathname === '/api/diagnostics/vk-startup' && body.bootId));
    assert.deepEqual(scenario.unexpected, []);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(outDir, `${role}.json`), JSON.stringify({ ...scenario, errors }, null, 2));
    await context.close();
    console.log(`PASS: real CORS, ${role} auth/profile/consent/navigation/role restore`);
  }
} finally {
  await browser.close();
  await Promise.all([staticServer, gateway].map((server) => new Promise((resolve) => server.close(resolve))));
}
