import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-stale-launch-smoke');
const port = 4192;
const gatewayHost = 'vk-gateway.invalid';
const vkUserId = '4242';
const freshToken = 'mock-vk-session-after-launch-refresh';
const storageKey = `pivnik_vk_${vkUserId}_session`;
const staleLaunchQuery = `vk_app_id=54694987&vk_user_id=${vkUserId}&vk_ts=111111&vk_platform=mobile_iphone&sign=stale-sign`;
const freshLaunchParams = {
  vk_app_id: 54694987,
  vk_user_id: vkUserId,
  vk_ts: 222222,
  vk_platform: 'mobile_iphone',
  sign: 'fresh-sign'
};

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2']
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const profile = {
  id: vkUserId,
  firstName: 'VK Launch',
  lastName: 'Refresh',
  username: 'vk_launch_refresh',
  provider: 'vk',
  role: 'user',
  balance: 888,
  termsAccepted: true,
  onboardingComplete: true,
  photoUrl: '',
  avatarSource: 'preset_male',
  avatarKey: null,
  profileFrame: 'none',
  monthlySpendCents: 0,
  totalSpendCents: 0,
  totalLiters: 0,
  beerProgressLiters: 0,
  beerGiftLiters: 0,
  status: { code: 'traveler', name: 'Путник', bonusPercent: 5, monthlySpendCents: 0, nextSpendCents: 1000000 },
  privacy: { publicProfile: true, showName: true, showAvatar: true, showMonthlySpend: true, showStats: true }
};

const freshPayload = {
  token: freshToken,
  profile,
  statuses: [],
  design: null,
  promotions: [],
  shopItems: [],
  achievements: [],
  transactions: [],
  walletConfig: null,
  leaderboard: { entries: [], currentUser: null }
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    const clean = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (clean.includes('..')) throw new Error('invalid path');
    const filePath = path.join(buildRoot, clean);
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

function json(body, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) };
}

function apiPayload(pathname) {
  if (pathname === '/api/me') return freshPayload;
  if (pathname === '/api/achievements') return { achievements: [], earned: [], unannounced: [] };
  if (pathname === '/api/leaderboard') return { entries: [], currentUser: null };
  if (pathname === '/api/promotions') return { promotions: [] };
  if (pathname === '/api/shop') return { items: [] };
  if (pathname === '/api/wheel/status') return { freeAvailable: true, nextFreeAt: null };
  return {};
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const apiCalls = [];
const bridgeCalls = [];
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const unexpectedMutations = [];

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
        body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams')return ${JSON.stringify(freshLaunchParams)};if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Launch',photo_200:''};return {};}};`
      });
      return;
    }
    await route.continue();
    return;
  }

  if (requestUrl.hostname === gatewayHost) {
    const method = request.method().toUpperCase();
    const pathname = requestUrl.pathname;
    const headers = request.headers();
    let body = null;
    try { body = request.postData() ? JSON.parse(request.postData()) : null; } catch (_) {}
    apiCalls.push({ pathname, method, authorization: headers.authorization || '', body });

    if (method !== 'GET' && !(method === 'POST' && pathname === '/api/auth')) {
      unexpectedMutations.push({ pathname, method });
      await route.fulfill(json({ error: 'mutation blocked by stale-launch smoke' }, 409));
      return;
    }

    if (pathname === '/api/auth') {
      const signed = String(body?.launchParams || '');
      if (signed.includes('sign=stale-sign')) {
        await route.fulfill(json({ error: 'invalid_launch_params' }, 401));
        return;
      }
      if (signed.includes('sign=fresh-sign') && signed.includes('vk_ts=222222')) {
        await route.fulfill(json(freshPayload));
        return;
      }
      await route.fulfill(json({ error: 'unexpected_launch_params' }, 400));
      return;
    }

    await route.fulfill(json(apiPayload(pathname)));
    return;
  }

  await route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
});

const appUrl = `http://127.0.0.1:${port}/index.html?${staleLaunchQuery}`;

try {
  const response = await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  assert(response?.status() === 200, `index returned ${response?.status()}`);

  await page.waitForFunction(() => {
    const shell = document.querySelector('#appShell');
    return shell && !shell.classList.contains('hidden');
  }, null, { timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('#clientName')?.textContent?.includes('VK Launch'), null, { timeout: 6000 });
  await page.waitForTimeout(250);

  const ui = await page.evaluate(({ key }) => ({
    platform: window.__PIVNIK_PLATFORM__,
    storagePrefix: window.__PIVNIK_STORAGE_PREFIX__,
    session: localStorage.getItem(key),
    clientName: document.querySelector('#clientName')?.textContent || '',
    balance: document.querySelector('#clientBalance')?.textContent || '',
    appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? true
  }), { key: storageKey });

  const authCalls = apiCalls.filter((call) => call.pathname === '/api/auth');
  const staleAuthCalls = authCalls.filter((call) => String(call.body?.launchParams || '').includes('sign=stale-sign'));
  const freshAuthCalls = authCalls.filter((call) => String(call.body?.launchParams || '').includes('sign=fresh-sign'));
  const launchRefreshCalls = bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams');
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !/status of 401|401 \(Unauthorized\)/i.test(message));

  assert(staleAuthCalls.length === 1, `stale signed launch params should be submitted exactly once, got ${staleAuthCalls.length}`);
  assert(freshAuthCalls.length >= 1 && freshAuthCalls.length <= 2, `expected refreshed auth plus optional profile hydration auth, got ${freshAuthCalls.length}`);
  assert(authCalls.length === staleAuthCalls.length + freshAuthCalls.length, `unexpected auth calls: ${JSON.stringify(authCalls)}`);
  assert(launchRefreshCalls.length === 1, `VKWebAppGetLaunchParams should run exactly once, got ${launchRefreshCalls.length}`);
  assert(String(staleAuthCalls[0].body?.launchParams || '').includes('vk_ts=111111'), 'stale auth did not use original signed timestamp');
  assert(freshAuthCalls.every((call) => String(call.body?.launchParams || '').includes('vk_ts=222222')), 'fresh auth did not use refreshed signed timestamp');
  assert(apiCalls.slice(apiCalls.indexOf(staleAuthCalls[0]) + 1).filter((call) => call.pathname === '/api/auth').every((call) => !String(call.body?.launchParams || '').includes('sign=stale-sign')), 'stale signature was reused after refresh');
  assert(ui.platform === 'vk', 'platform adapter is not VK');
  assert(ui.storagePrefix === `pivnik_vk_${vkUserId}_`, `wrong storage prefix ${ui.storagePrefix}`);
  assert(ui.session === freshToken, `fresh session was not persisted: ${ui.session}`);
  assert(ui.clientName.includes('VK Launch'), 'refreshed profile did not reach UI');
  assert(String(ui.balance).replace(/\s/g, '').includes('888'), `refreshed balance did not reach UI: ${ui.balance}`);
  assert(!ui.appShellHidden, 'app shell remained hidden after launch refresh');
  assert(bridgeCalls.includes('VKWebAppInit'), 'VKWebAppInit was not sent');
  assert(unexpectedMutations.length === 0, `unexpected mutations: ${JSON.stringify(unexpectedMutations)}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(unexpectedConsoleErrors.length === 0, `unexpected console errors: ${unexpectedConsoleErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `failed requests: ${JSON.stringify(failedRequests)}`);

  const evidence = { ok: true, apiCalls, bridgeCalls, ui, pageErrors, consoleErrors, unexpectedConsoleErrors, failedRequests, unexpectedMutations };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(outDir, 'recovered.png'), fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    outDir: path.relative(root, outDir),
    authCalls: authCalls.length,
    staleAuthCalls: staleAuthCalls.length,
    freshAuthCalls: freshAuthCalls.length,
    launchRefreshCalls: launchRefreshCalls.length,
    recoveredSession: ui.session === freshToken
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
