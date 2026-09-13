import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-reopen-smoke');
const port = 4190;
const gatewayHost = 'vk-gateway.invalid';
const vkUserId = '4242';
const sessionToken = 'mock-vk-session-reopen';
const storageKey = `pivnik_vk_${vkUserId}_session`;
const signedLaunchQuery = `vk_app_id=54694987&vk_user_id=${vkUserId}&vk_ts=123456&vk_platform=mobile_iphone&sign=mock-sign`;

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
  firstName: 'VK Reopen',
  lastName: 'Smoke',
  username: 'vk_reopen_smoke',
  provider: 'vk',
  role: 'user',
  balance: 654,
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

const basePayload = {
  token: sessionToken,
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
  if (pathname === '/api/auth' || pathname === '/api/bootstrap' || pathname === '/api/me') return basePayload;
  if (pathname === '/api/achievements') return { achievements: [], earned: [], unannounced: [] };
  if (pathname === '/api/leaderboard') return { entries: [], currentUser: null };
  if (pathname === '/api/promotions') return { promotions: [] };
  if (pathname === '/api/shop') return { items: [] };
  if (pathname === '/api/wheel/status') return { freeAvailable: true, nextFreeAt: null };
  return {};
}

async function waitForReady(page, label) {
  const response = await page.waitForResponse((candidate) => {
    const pathname = new URL(candidate.url()).pathname;
    return pathname === '/api/auth' || pathname === '/api/bootstrap';
  }, { timeout: 12000 }).catch(() => null);

  await page.waitForFunction(() => {
    const shell = document.querySelector('#appShell');
    return shell && !shell.classList.contains('hidden');
  }, null, { timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('#clientName')?.textContent?.includes('VK Reopen'), null, { timeout: 6000 });

  const ui = await page.evaluate(({ key }) => ({
    platform: window.__PIVNIK_PLATFORM__,
    storagePrefix: window.__PIVNIK_STORAGE_PREFIX__,
    session: localStorage.getItem(key),
    clientName: document.querySelector('#clientName')?.textContent || '',
    balance: document.querySelector('#clientBalance')?.textContent || '',
    appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? true
  }), { key: storageKey });

  assert(ui.platform === 'vk', `${label}: platform adapter is not VK`);
  assert(ui.storagePrefix === `pivnik_vk_${vkUserId}_`, `${label}: wrong storage prefix ${ui.storagePrefix}`);
  assert(ui.session === sessionToken, `${label}: scoped session missing`);
  assert(ui.clientName.includes('VK Reopen'), `${label}: profile did not reach UI`);
  assert(String(ui.balance).replace(/\s/g, '').includes('654'), `${label}: balance did not reach UI: ${ui.balance}`);
  assert(!ui.appShellHidden, `${label}: app shell remained hidden`);
  return { responseStatus: response?.status() ?? null, ui };
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const apiCalls = [];
const bridgeCalls = [];
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const badResponses = [];
const unexpectedMutations = [];

await context.exposeFunction('__recordVkBridgeCall', (method) => bridgeCalls.push(method));
await context.route('**/*', async (route) => {
  const request = route.request();
  const requestUrl = new URL(request.url());

  if (requestUrl.hostname === '127.0.0.1') {
    if (requestUrl.pathname.endsWith('/vendor/vk-bridge.js')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams')return {vk_app_id:54694987,vk_user_id:${vkUserId},vk_ts:123456,vk_platform:'mobile_iphone',sign:'mock-sign'};if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Reopen',photo_200:''};return {};}};`
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
    apiCalls.push({ pathname, method, authorization: headers.authorization || '' });

    if (method !== 'GET' && !(method === 'POST' && pathname === '/api/auth')) {
      unexpectedMutations.push({ pathname, method });
      await route.fulfill(json({ error: 'mutation blocked by reopen smoke' }, 409));
      return;
    }

    await route.fulfill(json(apiPayload(pathname)));
    return;
  }

  await route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
});

context.on('page', (page) => {
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }));
  page.on('response', (response) => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); });
});

const appUrl = `http://127.0.0.1:${port}/index.html?${signedLaunchQuery}`;

try {
  const firstPage = await context.newPage();
  const firstNavigation = firstPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const first = await waitForReady(firstPage, 'fresh launch');
  await firstNavigation;
  await firstPage.screenshot({ path: path.join(outDir, 'fresh.png'), fullPage: true });

  const firstAuthCount = apiCalls.filter((call) => call.pathname === '/api/auth').length;
  assert(firstAuthCount === 1, `fresh launch: expected one /api/auth, got ${firstAuthCount}`);

  const beforeReloadCount = apiCalls.length;
  const reloadNavigation = firstPage.reload({ waitUntil: 'domcontentloaded' });
  const reload = await waitForReady(firstPage, 'reload');
  await reloadNavigation;
  await firstPage.screenshot({ path: path.join(outDir, 'reload.png'), fullPage: true });

  const reloadCalls = apiCalls.slice(beforeReloadCount);
  assert(reloadCalls.some((call) => call.pathname === '/api/bootstrap' && call.authorization === `Bearer ${sessionToken}`), 'reload: scoped session did not use authenticated /api/bootstrap');
  assert(!reloadCalls.some((call) => call.pathname === '/api/auth'), 'reload: unexpectedly repeated /api/auth despite scoped session');

  await firstPage.close();

  const beforeReopenCount = apiCalls.length;
  const reopenedPage = await context.newPage();
  const reopenNavigation = reopenedPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const reopened = await waitForReady(reopenedPage, 'reopen');
  await reopenNavigation;
  await reopenedPage.screenshot({ path: path.join(outDir, 'reopen.png'), fullPage: true });

  const reopenCalls = apiCalls.slice(beforeReopenCount);
  assert(reopenCalls.some((call) => call.pathname === '/api/bootstrap' && call.authorization === `Bearer ${sessionToken}`), 'reopen: scoped session did not survive new page');
  assert(!reopenCalls.some((call) => call.pathname === '/api/auth'), 'reopen: unexpectedly repeated /api/auth despite persisted scoped session');

  assert(bridgeCalls.filter((method) => method === 'VKWebAppInit').length >= 3, 'VKWebAppInit did not run for fresh/reload/reopen lifecycle');
  assert(unexpectedMutations.length === 0, `unexpected mutations: ${JSON.stringify(unexpectedMutations)}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `failed requests: ${JSON.stringify(failedRequests)}`);
  assert(badResponses.length === 0, `HTTP errors: ${JSON.stringify(badResponses)}`);

  const evidence = { ok: true, first, reload, reopened, apiCalls, bridgeCalls, pageErrors, consoleErrors, failedRequests, badResponses, unexpectedMutations };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    ok: true,
    outDir: path.relative(root, outDir),
    authCalls: apiCalls.filter((call) => call.pathname === '/api/auth').length,
    bootstrapCalls: apiCalls.filter((call) => call.pathname === '/api/bootstrap').length,
    vkInitCalls: bridgeCalls.filter((method) => method === 'VKWebAppInit').length
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
