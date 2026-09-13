import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-foreground-expired-session-smoke');
const port = 4198;
const gatewayHost = 'vk-gateway.invalid';
const vkUserId = '4242';
const initialToken = 'foreground-old-session';
const renewedToken = 'foreground-renewed-session';
const signedLaunchQuery = `vk_app_id=54694987&vk_user_id=${vkUserId}&vk_ts=444444&vk_platform=mobile_iphone&sign=foreground-expired-sign`;
const storageKey = `pivnik_vk_${vkUserId}_session`;

const profile = {
  id: vkUserId, firstName: 'VK Foreground', lastName: 'Renewed', username: 'vk_foreground_renewed',
  provider: 'vk', role: 'user', balance: 888, termsAccepted: true, onboardingComplete: true,
  photoUrl: '', avatarSource: 'preset_male', avatarKey: null, profileFrame: 'none',
  monthlySpendCents: 0, totalSpendCents: 0, totalLiters: 0, beerProgressLiters: 0, beerGiftLiters: 0,
  status: { code: 'traveler', name: 'Путник', bonusPercent: 5, monthlySpendCents: 0, nextSpendCents: 1000000 },
  privacy: { publicProfile: true, showName: true, showAvatar: true, showMonthlySpend: true, showStats: true }
};
function payload(token) {
  return {
    token, profile, statuses: [], design: null, promotions: [], shopItems: [], achievements: [], transactions: [],
    walletConfig: null, leaderboard: { entries: [], currentUser: null }
  };
}
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2']
]);
function assert(condition, message) { if (!condition) throw new Error(message); }
function json(body, status = 200) { return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) }; }
function apiPayload(pathname, token = renewedToken) {
  if (pathname === '/api/bootstrap' || pathname === '/api/me') return payload(token);
  if (pathname === '/api/me/transactions') return { transactions: [] };
  if (pathname === '/api/achievements') return { achievements: [], earned: [], unannounced: [] };
  if (pathname === '/api/leaderboard') return { entries: [], currentUser: null };
  if (pathname === '/api/promotions') return { promotions: [] };
  if (pathname === '/api/shop') return { items: [] };
  if (pathname === '/api/wheel/status') return { freeAvailable: true, nextFreeAt: null };
  return {};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/favicon.ico') return void res.writeHead(204, { 'cache-control': 'no-store' }).end();
    const clean = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (clean.includes('..')) throw new Error('invalid path');
    const filePath = path.join(buildRoot, clean);
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const apiCalls = [];
const bridgeCalls = [];
const unexpectedMutations = [];
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
let authCount = 0;
let expired = false;

page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (!text.includes('401')) consoleErrors.push(text);
});
page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }));
await page.exposeFunction('__recordVkBridgeCall', (method) => bridgeCalls.push(method));

await page.route('**/*', async (route) => {
  const request = route.request();
  const requestUrl = new URL(request.url());
  if (requestUrl.hostname === '127.0.0.1') {
    if (requestUrl.pathname.endsWith('/vendor/vk-bridge.js')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams')return {vk_app_id:54694987,vk_user_id:${vkUserId},vk_ts:444444,vk_platform:'mobile_iphone',sign:'foreground-expired-sign'};if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Foreground',photo_200:''};return {};}};`
      });
      return;
    }
    await route.continue();
    return;
  }
  if (requestUrl.hostname === gatewayHost) {
    const method = request.method().toUpperCase();
    const pathname = requestUrl.pathname;
    const authorization = request.headers().authorization || '';
    apiCalls.push({ pathname, method, authorization });

    if (method === 'POST' && pathname === '/api/auth') {
      authCount += 1;
      await route.fulfill(json(payload(authCount === 1 ? initialToken : renewedToken)));
      return;
    }
    if (method !== 'GET') {
      unexpectedMutations.push({ pathname, method });
      await route.fulfill(json({ error: 'mutation blocked by foreground expired-session smoke' }, 409));
      return;
    }
    if (expired && pathname === '/api/me/transactions' && authorization === `Bearer ${initialToken}`) {
      await route.fulfill(json({ error: 'Требуется вход в приложение.' }, 401));
      return;
    }
    await route.fulfill(json(apiPayload(pathname, authorization === `Bearer ${initialToken}` ? initialToken : renewedToken)));
    return;
  }
  await route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
});

async function pulseVisibility() {
  await page.evaluate(() => {
    let hidden = true;
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    } catch (_) {}
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

try {
  const response = await page.goto(`http://127.0.0.1:${port}/index.html?${signedLaunchQuery}`, { waitUntil: 'domcontentloaded' });
  assert(response?.status() === 200, `index returned ${response?.status()}`);
  await page.waitForFunction(() => document.querySelector('#appShell') && !document.querySelector('#appShell').classList.contains('hidden'), null, { timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('#clientName')?.textContent?.includes('VK Foreground'), null, { timeout: 6000 });
  await page.waitForTimeout(1600);

  assert(authCount === 1, `initial auth count unexpected: ${authCount}`);
  assert(await page.evaluate((key) => localStorage.getItem(key), storageKey) === initialToken, 'initial scoped session missing');

  await pulseVisibility();
  await page.waitForTimeout(500);
  expired = true;

  await page.click('.bottom-nav [data-target="profile"]');
  await page.waitForFunction((key) => localStorage.getItem(key) === 'foreground-renewed-session', storageKey, { timeout: 8000 });
  await page.waitForTimeout(500);

  const transactionCalls = apiCalls.filter((call) => call.pathname === '/api/me/transactions');
  const authCalls = apiCalls.filter((call) => call.pathname === '/api/auth');
  const ui = await page.evaluate((key) => ({
    session: localStorage.getItem(key),
    appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? true,
    clientName: document.querySelector('#clientName')?.textContent || '',
    balance: document.querySelector('#clientBalance')?.textContent || ''
  }), storageKey);

  assert(authCalls.length === 2, `expected exactly one recovery auth, got ${authCalls.length}`);
  assert(transactionCalls.length === 2, `expected one failed and one retried transactions request, got ${transactionCalls.length}`);
  assert(transactionCalls[0].authorization === `Bearer ${initialToken}`, `first transactions request did not use expired token: ${transactionCalls[0].authorization}`);
  assert(transactionCalls[1].authorization === `Bearer ${renewedToken}`, `retried transactions request did not use renewed token: ${transactionCalls[1].authorization}`);
  assert(ui.session === renewedToken, `renewed scoped session missing: ${ui.session}`);
  assert(!ui.appShellHidden, 'recovery closed the app shell');
  assert(ui.clientName.includes('VK Foreground'), `profile lost after recovery: ${ui.clientName}`);
  assert(String(ui.balance).replace(/\s/g, '').includes('888'), `balance lost after recovery: ${ui.balance}`);
  assert(unexpectedMutations.length === 0, `unexpected mutations: ${JSON.stringify(unexpectedMutations)}`);
  assert(bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams').length === 0, `post-boot recovery unexpectedly refreshed launch params: ${JSON.stringify(bridgeCalls)}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `failed requests: ${JSON.stringify(failedRequests)}`);

  const evidence = { ok: true, authCalls, transactionCalls, bridgeCalls, ui, unexpectedMutations, pageErrors, consoleErrors, failedRequests };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(outDir, 'foreground-expired-session-recovered.png'), fullPage: true });
  console.log(JSON.stringify({ ok: true, authCount: authCalls.length, transactionCalls: transactionCalls.length, renewedSession: ui.session === renewedToken }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
