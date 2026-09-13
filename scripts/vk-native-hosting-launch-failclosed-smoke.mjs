import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-launch-failclosed-smoke');
const port = 4193;
const gatewayHost = 'vk-gateway.invalid';
const vkUserId = '4242';
const storageKey = `pivnik_vk_${vkUserId}_session`;
const staleLaunchQuery = `vk_app_id=54694987&vk_user_id=${vkUserId}&vk_ts=111111&vk_platform=mobile_iphone&sign=stale-sign`;

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2']
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function json(body, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/favicon.ico') return void res.writeHead(204, { 'cache-control': 'no-store' }).end();
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

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });

async function runScenario({ name, bridgeLaunchParams, expectedAuthAttempts = 1, expectedFreshAttempts = 0 }) {
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
          body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams')return ${JSON.stringify(bridgeLaunchParams)};if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Fail Closed',photo_200:''};return {};}};`
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
        await route.fulfill(json({ error: 'mutation blocked by fail-closed smoke' }, 409));
        return;
      }
      if (pathname === '/api/auth') {
        await route.fulfill(json({ error: 'invalid_launch_params' }, 401));
        return;
      }
      await route.fulfill(json({}));
      return;
    }
    await route.fulfill({ status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
  });

  try {
    const response = await page.goto(`http://127.0.0.1:${port}/index.html?${staleLaunchQuery}`, { waitUntil: 'domcontentloaded' });
    assert(response?.status() === 200, `${name}: index returned ${response?.status()}`);
    await page.waitForFunction(() => {
      const actions = document.querySelector('#bootActions');
      return actions && !actions.classList.contains('hidden');
    }, null, { timeout: 12000 });
    await page.waitForTimeout(200);

    const ui = await page.evaluate(({ key }) => ({
      platform: window.__PIVNIK_PLATFORM__,
      storagePrefix: window.__PIVNIK_STORAGE_PREFIX__,
      session: localStorage.getItem(key),
      appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? false,
      bootActionsHidden: document.querySelector('#bootActions')?.classList.contains('hidden') ?? true,
      bootText: document.querySelector('#bootText')?.textContent || ''
    }), { key: storageKey });
    const authCalls = apiCalls.filter((call) => call.pathname === '/api/auth');
    const staleAuthCalls = authCalls.filter((call) => String(call.body?.launchParams || '').includes('sign=stale-sign'));
    const freshAuthCalls = authCalls.filter((call) => String(call.body?.launchParams || '').includes('sign=fresh-sign'));
    const refreshCalls = bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams');
    const unexpectedConsoleErrors = consoleErrors.filter((message) => (
      !/status of 401|401 \(Unauthorized\)/i.test(message)
      && !/^Boot failed: Error: invalid_launch_params\b/i.test(message)
    ));

    const evidence = { name, apiCalls, bridgeCalls, ui, pageErrors, consoleErrors, unexpectedConsoleErrors, failedRequests, unexpectedMutations };
    await fs.writeFile(path.join(outDir, `${name}.json`), JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });

    assert(authCalls.length === expectedAuthAttempts, `${name}: expected ${expectedAuthAttempts} auth attempt(s), got ${authCalls.length}`);
    assert(staleAuthCalls.length === 1, `${name}: stale signed launch params should be submitted exactly once, got ${staleAuthCalls.length}`);
    assert(String(staleAuthCalls[0].body?.launchParams || '').includes('vk_ts=111111'), `${name}: initial auth did not use original signed launch params`);
    assert(freshAuthCalls.length === expectedFreshAttempts, `${name}: expected ${expectedFreshAttempts} fresh auth attempt(s), got ${freshAuthCalls.length}`);
    if (expectedFreshAttempts > 0) {
      assert(freshAuthCalls.every((call) => String(call.body?.launchParams || '').includes('vk_ts=222222')), `${name}: refreshed auth did not use the fresh signed timestamp`);
      assert(authCalls.indexOf(freshAuthCalls[0]) > authCalls.indexOf(staleAuthCalls[0]), `${name}: refreshed auth did not follow the stale auth attempt`);
    }
    assert(refreshCalls.length === 1, `${name}: VKWebAppGetLaunchParams should run exactly once, got ${refreshCalls.length}`);
    assert(ui.platform === 'vk', `${name}: platform adapter is not VK`);
    assert(ui.storagePrefix === `pivnik_vk_${vkUserId}_`, `${name}: wrong storage prefix ${ui.storagePrefix}`);
    assert(ui.session === null, `${name}: failed auth created a false session: ${ui.session}`);
    assert(ui.appShellHidden, `${name}: app shell opened despite failed authentication`);
    assert(!ui.bootActionsHidden, `${name}: retry/error controls were not shown`);
    assert(/войти|повтор|подключ|ошиб|запуск|параметр|invalid_launch_params/i.test(ui.bootText), `${name}: boot error state was not user-visible: ${ui.bootText}`);
    assert(bridgeCalls.includes('VKWebAppInit'), `${name}: VKWebAppInit was not sent`);
    assert(unexpectedMutations.length === 0, `${name}: unexpected mutations: ${JSON.stringify(unexpectedMutations)}`);
    assert(pageErrors.length === 0, `${name}: page errors: ${pageErrors.join(' | ')}`);
    assert(unexpectedConsoleErrors.length === 0, `${name}: unexpected console errors: ${unexpectedConsoleErrors.join(' | ')}`);
    assert(failedRequests.length === 0, `${name}: failed requests: ${JSON.stringify(failedRequests)}`);
    return evidence;
  } finally {
    await context.close();
  }
}

try {
  const results = [
    await runScenario({
      name: 'incomplete-refresh',
      bridgeLaunchParams: { vk_app_id: 54694987, vk_user_id: vkUserId, vk_ts: 222222, vk_platform: 'mobile_iphone' }
    }),
    await runScenario({
      name: 'unchanged-refresh',
      bridgeLaunchParams: { vk_app_id: 54694987, vk_user_id: vkUserId, vk_ts: 111111, vk_platform: 'mobile_iphone', sign: 'stale-sign' }
    }),
    await runScenario({
      name: 'fresh-refresh-second-auth-401',
      bridgeLaunchParams: { vk_app_id: 54694987, vk_user_id: vkUserId, vk_ts: 222222, vk_platform: 'mobile_iphone', sign: 'fresh-sign' },
      expectedAuthAttempts: 2,
      expectedFreshAttempts: 1
    })
  ];
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ ok: true, results }, null, 2));
  console.log(JSON.stringify({
    ok: true,
    outDir: path.relative(root, outDir),
    scenarios: results.map((result) => ({
      name: result.name,
      authCalls: result.apiCalls.filter((call) => call.pathname === '/api/auth').length,
      launchRefreshCalls: result.bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams').length,
      falseSessionCreated: result.ui.session !== null,
      errorStateVisible: !result.ui.bootActionsHidden
    }))
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
