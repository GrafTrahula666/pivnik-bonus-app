import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-background-retry-smoke');
const port = 4196;
const gatewayHost = 'vk-gateway.invalid';
const vkUserId = '4242';
const sessionToken = 'background-retry-session';
const storageKey = `pivnik_vk_${vkUserId}_session`;
const staleLaunchQuery = `vk_app_id=54694987&vk_user_id=${vkUserId}&vk_ts=111111&vk_platform=mobile_iphone&sign=stale-sign`;
const freshLaunch = { vk_app_id: 54694987, vk_user_id: Number(vkUserId), vk_ts: 222222, vk_platform: 'mobile_iphone', sign: 'fresh-sign' };

const profile = {
  id: vkUserId, firstName: 'VK Background', lastName: 'Recovered', username: 'vk_background_recovered',
  provider: 'vk', role: 'user', balance: 888, termsAccepted: true, onboardingComplete: true,
  photoUrl: '', avatarSource: 'preset_male', avatarKey: null, profileFrame: 'none',
  monthlySpendCents: 0, totalSpendCents: 0, totalLiters: 0, beerProgressLiters: 0, beerGiftLiters: 0,
  status: { code: 'traveler', name: 'Путник', bonusPercent: 5, monthlySpendCents: 0, nextSpendCents: 1000000 },
  privacy: { publicProfile: true, showName: true, showAvatar: true, showMonthlySpend: true, showStats: true }
};
const successPayload = {
  token: sessionToken, profile, statuses: [], design: null, promotions: [], shopItems: [], achievements: [],
  transactions: [], walletConfig: null, leaderboard: { entries: [], currentUser: null }
};
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2']
]);
function assert(condition, message) { if (!condition) throw new Error(message); }
function json(body, status = 200) { return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) }; }
function apiPayload(pathname) {
  if (pathname === '/api/auth' || pathname === '/api/bootstrap' || pathname === '/api/me') return successPayload;
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

page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
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
        body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams'){window.__backgroundLaunchCount=(window.__backgroundLaunchCount||0)+1;const attempt=window.__backgroundLaunchCount;await new Promise(resolve=>setTimeout(resolve,350));if(attempt===1)throw new Error('synthetic background refresh failure');return ${JSON.stringify(freshLaunch)};}if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Background',photo_200:''};return {};}};`
      });
      return;
    }
    await route.continue();
    return;
  }
  if (requestUrl.hostname === gatewayHost) {
    const method = request.method().toUpperCase();
    const pathname = requestUrl.pathname;
    let body = null;
    try { body = request.postData() ? JSON.parse(request.postData()) : null; } catch (_) {}
    apiCalls.push({ pathname, method, authorization: request.headers().authorization || '', body });
    if (method !== 'GET' && !(method === 'POST' && pathname === '/api/auth')) {
      unexpectedMutations.push({ pathname, method });
      await route.fulfill(json({ error: 'mutation blocked by background retry smoke' }, 409));
      return;
    }
    if (pathname === '/api/auth') {
      const launchParams = String(body?.launchParams || '');
      if (!launchParams.includes('sign=fresh-sign')) {
        await route.fulfill(json({ error: 'invalid_launch_params' }, 401));
        return;
      }
      await route.fulfill(json(successPayload));
      return;
    }
    await route.fulfill(json(apiPayload(pathname)));
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
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

try {
  const response = await page.goto(`http://127.0.0.1:${port}/index.html?${staleLaunchQuery}`, { waitUntil: 'domcontentloaded' });
  assert(response?.status() === 200, `index returned ${response?.status()}`);

  await page.waitForFunction(() => window.__backgroundLaunchCount === 1, null, { timeout: 8000 });
  await pulseVisibility();
  await page.waitForFunction(() => {
    const actions = document.querySelector('#bootActions');
    return actions && !actions.classList.contains('hidden');
  }, null, { timeout: 15000 });
  await page.waitForTimeout(200);

  const initialAuth = apiCalls.filter((call) => call.pathname === '/api/auth');
  assert(initialAuth.length === 1, `background/foreground during failed refresh created duplicate auth: ${initialAuth.length}`);
  assert(bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams').length === 1, 'background/foreground duplicated initial launch refresh');
  assert(await page.evaluate((key) => localStorage.getItem(key), storageKey) === null, 'failed initial flow created a session');

  await page.click('#bootRetry');
  await page.waitForFunction(() => window.__backgroundLaunchCount === 2, null, { timeout: 5000 });
  await pulseVisibility();

  await page.waitForFunction(() => {
    const shell = document.querySelector('#appShell');
    return shell && !shell.classList.contains('hidden');
  }, null, { timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('#clientName')?.textContent?.includes('VK Background'), null, { timeout: 6000 });
  await page.waitForTimeout(350);

  const authCalls = apiCalls.filter((call) => call.pathname === '/api/auth');
  const staleAuthCalls = authCalls.filter((call) => String(call.body?.launchParams || '').includes('sign=stale-sign'));
  const freshAuthCalls = authCalls.filter((call) => String(call.body?.launchParams || '').includes('sign=fresh-sign'));
  const refreshCalls = bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams');
  const ui = await page.evaluate(({ key }) => ({
    session: localStorage.getItem(key),
    appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? true,
    bootHidden: document.querySelector('#bootScreen')?.classList.contains('hidden') ?? false,
    clientName: document.querySelector('#clientName')?.textContent || '',
    balance: document.querySelector('#clientBalance')?.textContent || ''
  }), { key: storageKey });
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !/status of 401|401 \(Unauthorized\)/i.test(message) && !/^Boot failed: Error: invalid_launch_params\b/i.test(message));

  assert(staleAuthCalls.length === 2, `expected one initial and one manual-retry stale auth, got ${staleAuthCalls.length}`);
  assert(freshAuthCalls.length >= 1 && freshAuthCalls.length <= 2, `expected one auth success plus optional profile sync, got ${freshAuthCalls.length}`);
  assert(refreshCalls.length === 2, `visibility transitions must not duplicate Bridge refreshes, got ${refreshCalls.length}`);
  assert(ui.session === sessionToken, `recovered session was not persisted: ${ui.session}`);
  assert(!ui.appShellHidden && ui.bootHidden, 'app did not leave boot screen after background/foreground recovery');
  assert(ui.clientName.includes('VK Background'), `recovered profile did not reach UI: ${ui.clientName}`);
  assert(String(ui.balance).replace(/\s/g, '').includes('888'), `recovered balance did not reach UI: ${ui.balance}`);
  assert(unexpectedMutations.length === 0, `unexpected mutations: ${JSON.stringify(unexpectedMutations)}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(unexpectedConsoleErrors.length === 0, `unexpected console errors: ${unexpectedConsoleErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `failed requests: ${JSON.stringify(failedRequests)}`);

  const evidence = { ok: true, apiCalls, bridgeCalls, ui, unexpectedMutations, pageErrors, consoleErrors, unexpectedConsoleErrors, failedRequests };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(outDir, 'background-retry-success.png'), fullPage: true });
  console.log(JSON.stringify({ ok: true, authCalls: authCalls.length, staleAuthCalls: staleAuthCalls.length, freshAuthCalls: freshAuthCalls.length, launchRefreshCalls: refreshCalls.length, sessionPersisted: ui.session === sessionToken }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
