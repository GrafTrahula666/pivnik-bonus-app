import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-bootstrap-smoke');
const port = 4189;
const gatewayHost = 'vk-gateway.invalid';
const vkUserId = '4242';
const sessionToken = 'mock-vk-session';
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
  firstName: 'VK Smoke',
  lastName: 'Test',
  username: 'vk_smoke_test',
  provider: 'vk',
  role: 'user',
  balance: 321,
  termsAccepted: true,
  onboardingComplete: true,
  photoUrl: '',
  avatarSource: 'preset_male',
  avatarKey: null,
  profileFrame: 'none',
  monthlySpendCents: 125000,
  totalSpendCents: 250000,
  totalLiters: 12.5,
  beerProgressLiters: 3,
  beerGiftLiters: 0,
  status: {
    code: 'traveler',
    name: 'Путник',
    bonusPercent: 5,
    monthlySpendCents: 125000,
    nextSpendCents: 1000000
  },
  privacy: {
    publicProfile: true,
    showName: true,
    showAvatar: true,
    showMonthlySpend: true,
    showStats: true
  }
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
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body)
  };
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

async function runScenario(browser, { name, restoreSession }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const apiCalls = [];
  const bridgeCalls = [];
  const pageErrors = [];
  const consoleErrors = [];
  const unexpectedMutations = [];
  const failedRequests = [];
  const badResponses = [];

  if (restoreSession) {
    await page.addInitScript(({ key, value }) => {
      try { localStorage.setItem(key, value); } catch (_) {}
    }, { key: `pivnik_vk_${vkUserId}_session`, value: sessionToken });
  }

  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }));
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() });
  });

  await page.exposeFunction('__recordVkBridgeCall', (method) => bridgeCalls.push(method));

  await page.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());

    if (requestUrl.hostname === '127.0.0.1') {
      if (requestUrl.pathname.endsWith('/vendor/vk-bridge.js')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/javascript; charset=utf-8',
          body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams')return {vk_app_id:54694987,vk_user_id:${vkUserId},vk_ts:123456,vk_platform:'mobile_iphone',sign:'mock-sign'};if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Smoke',photo_200:''};return {};}};`
        });
        return;
      }
      await route.continue();
      return;
    }

    if (requestUrl.hostname === gatewayHost) {
      const method = request.method().toUpperCase();
      const pathname = requestUrl.pathname;
      let parsedBody = null;
      try { parsedBody = request.postData() ? JSON.parse(request.postData()) : null; } catch (_) {}
      const headers = request.headers();
      apiCalls.push({ pathname, method, body: parsedBody, authorization: headers.authorization || '' });

      if (method !== 'GET' && !(method === 'POST' && pathname === '/api/auth')) {
        unexpectedMutations.push({ pathname, method });
        await route.fulfill(json({ error: 'mutation blocked by bootstrap smoke' }, 409));
        return;
      }

      await route.fulfill(json(apiPayload(pathname)));
      return;
    }

    await route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
  });

  const url = `http://127.0.0.1:${port}/index.html?${signedLaunchQuery}`;
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert(response?.status() === 200, `${name}: index returned ${response?.status()}`);

  await page.waitForFunction(() => {
    const shell = document.querySelector('#appShell');
    return shell && !shell.classList.contains('hidden');
  }, null, { timeout: 12000 });

  await page.waitForFunction(() => document.querySelector('#clientName')?.textContent?.includes('VK Smoke'), null, { timeout: 6000 });
  await page.waitForTimeout(250);

  const ui = await page.evaluate(({ storageKey }) => ({
    platform: window.__PIVNIK_PLATFORM__,
    storagePrefix: window.__PIVNIK_STORAGE_PREFIX__,
    storedSession: localStorage.getItem(storageKey),
    clientName: document.querySelector('#clientName')?.textContent || '',
    balance: document.querySelector('#clientBalance')?.textContent || '',
    appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? true,
    bootHidden: document.querySelector('#bootScreen')?.classList.contains('hidden') ?? false
  }), { storageKey: `pivnik_vk_${vkUserId}_session` });

  assert(ui.platform === 'vk', `${name}: platform adapter is not VK`);
  assert(ui.storagePrefix === `pivnik_vk_${vkUserId}_`, `${name}: wrong scoped storage prefix ${ui.storagePrefix}`);
  assert(ui.storedSession === sessionToken, `${name}: scoped session was not persisted/restored`);
  assert(ui.clientName.includes('VK Smoke'), `${name}: profile did not reach UI: ${ui.clientName}`);
  assert(String(ui.balance).replace(/\s/g, '').includes('321'), `${name}: wallet balance did not reach UI: ${ui.balance}`);
  assert(!ui.appShellHidden, `${name}: app shell remained hidden`);
  assert(bridgeCalls.includes('VKWebAppInit'), `${name}: VKWebAppInit was not sent`);
  assert(unexpectedMutations.length === 0, `${name}: unexpected mutations: ${JSON.stringify(unexpectedMutations)}`);
  assert(pageErrors.length === 0, `${name}: page errors: ${pageErrors.join(' | ')}`);
  assert(badResponses.length === 0, `${name}: HTTP errors: ${JSON.stringify(badResponses)}`);
  assert(consoleErrors.length === 0, `${name}: console errors: ${consoleErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `${name}: failed requests: ${JSON.stringify(failedRequests)}`);

  if (restoreSession) {
    const bootstrap = apiCalls.find((call) => call.pathname === '/api/bootstrap');
    assert(bootstrap, `${name}: stored session did not use /api/bootstrap`);
    assert(bootstrap.authorization === `Bearer ${sessionToken}`, `${name}: bootstrap missed scoped bearer session`);
  } else {
    const auth = apiCalls.find((call) => call.pathname === '/api/auth' && call.method === 'POST');
    assert(auth, `${name}: fresh launch did not authenticate`);
    assert(auth.body?.platform === 'vk', `${name}: auth payload platform is not VK`);
    assert(String(auth.body?.launchParams || '').includes(`vk_user_id=${vkUserId}`), `${name}: signed VK user id missing from auth payload`);
    assert(String(auth.body?.launchParams || '').includes('sign=mock-sign'), `${name}: signature missing from auth payload`);
  }

  const evidence = { name, restoreSession, bridgeCalls, apiCalls, ui, pageErrors, consoleErrors, failedRequests, badResponses, unexpectedMutations };
  await fs.writeFile(path.join(outDir, `${name}.json`), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  await context.close();
  return evidence;
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true });
try {
  const fresh = await runScenario(browser, { name: 'fresh-auth', restoreSession: false });
  const restored = await runScenario(browser, { name: 'session-restore', restoreSession: true });
  const summary = { ok: true, fresh, restored };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({
    ok: true,
    outDir: path.relative(root, outDir),
    freshApiCalls: fresh.apiCalls.map(({ pathname, method }) => `${method} ${pathname}`),
    restoredApiCalls: restored.apiCalls.map(({ pathname, method }) => `${method} ${pathname}`)
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
