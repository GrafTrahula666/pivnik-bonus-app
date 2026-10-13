import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-bridge-refresh-failure-smoke');
const port = 4194;
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

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
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

async function runScenario({ name, refreshMode }) {
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
        const launchRefreshBehavior = refreshMode === 'timeout'
          ? "return new Promise(()=>{});"
          : "throw new Error('synthetic launch refresh failure');";
        await route.fulfill({
          status: 200,
          contentType: 'text/javascript; charset=utf-8',
          body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams'){${launchRefreshBehavior}}if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Bridge Failure',photo_200:''};return {};}};`
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
      const allowedPost = method === 'POST' && (
        pathname === '/api/auth' || pathname === '/api/diagnostics/vk-startup'
      );
      if (method !== 'GET' && !allowedPost) {
        unexpectedMutations.push({ pathname, method });
        await route.fulfill(json({ error: 'mutation blocked by bridge failure smoke' }, 409));
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
    }, null, { timeout: 15000 });
    await page.waitForTimeout(200);

    const initialUi = await page.evaluate(({ key }) => ({
      platform: window.__PIVNIK_PLATFORM__,
      storagePrefix: window.__PIVNIK_STORAGE_PREFIX__,
      session: localStorage.getItem(key),
      appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? false,
      bootActionsHidden: document.querySelector('#bootActions')?.classList.contains('hidden') ?? true,
      retryVisible: Boolean(document.querySelector('#bootRetry')),
      bootText: document.querySelector('#bootText')?.textContent || ''
    }), { key: storageKey });

    let authCalls = apiCalls.filter((call) => call.pathname === '/api/auth');
    let refreshCalls = bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams');
    assert(authCalls.length === 1, `${name}: initial bridge refresh failure must not trigger a second auth attempt, got ${authCalls.length}`);
    assert(String(authCalls[0].body?.launchParams || '').includes('sign=stale-sign'), `${name}: initial auth did not use original signed launch params`);
    assert(refreshCalls.length === 1, `${name}: initial VKWebAppGetLaunchParams should run exactly once, got ${refreshCalls.length}`);
    assert(initialUi.platform === 'vk', `${name}: platform adapter is not VK`);
    assert(initialUi.storagePrefix === `pivnik_vk_${vkUserId}_`, `${name}: wrong storage prefix ${initialUi.storagePrefix}`);
    assert(initialUi.session === null, `${name}: bridge refresh failure created a false session: ${initialUi.session}`);
    assert(initialUi.appShellHidden, `${name}: app shell opened despite failed authentication`);
    assert(!initialUi.bootActionsHidden && initialUi.retryVisible, `${name}: recoverable retry controls were not shown`);
    assert(/войти|повтор|подключ|ошиб|запуск|параметр|invalid_launch_params/i.test(initialUi.bootText), `${name}: error state was not user-visible: ${initialUi.bootText}`);

    await page.evaluate(() => {
      const retry = document.querySelector('#bootRetry');
      retry?.click();
      retry?.click();
      retry?.click();
    });

    await waitUntil(
      () => apiCalls.filter((call) => call.pathname === '/api/auth').length >= 2,
      4000,
      `${name}: manual retry did not start a new auth cycle`
    );
    await waitUntil(
      () => bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams').length >= 2,
      refreshMode === 'timeout' ? 6000 : 4000,
      `${name}: manual retry did not request fresh VK launch params`
    );
    await page.waitForFunction(() => {
      const actions = document.querySelector('#bootActions');
      return actions && !actions.classList.contains('hidden');
    }, null, { timeout: 8000 });
    await page.waitForTimeout(refreshMode === 'timeout' ? 2400 : 300);

    authCalls = apiCalls.filter((call) => call.pathname === '/api/auth');
    refreshCalls = bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams');
    const retryUi = await page.evaluate(({ key }) => ({
      session: localStorage.getItem(key),
      appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? false,
      bootActionsHidden: document.querySelector('#bootActions')?.classList.contains('hidden') ?? true,
      retryVisible: Boolean(document.querySelector('#bootRetry')),
      bootText: document.querySelector('#bootText')?.textContent || ''
    }), { key: storageKey });

    const unexpectedConsoleErrors = consoleErrors.filter((message) => (
      !/status of 401|401 \(Unauthorized\)/i.test(message)
      && !/^Boot failed: Error: invalid_launch_params\b/i.test(message)
    ));
    const evidence = {
      name,
      refreshMode,
      apiCalls,
      bridgeCalls,
      initialUi,
      retryUi,
      pageErrors,
      consoleErrors,
      unexpectedConsoleErrors,
      failedRequests,
      unexpectedMutations
    };
    await fs.writeFile(path.join(outDir, `${name}.json`), JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });

    assert(authCalls.length === 2, `${name}: three rapid retry clicks must create exactly one new auth cycle, got ${authCalls.length} total auth calls`);
    assert(authCalls.every((call) => String(call.body?.launchParams || '').includes('sign=stale-sign')), `${name}: retry unexpectedly changed stale params after Bridge failure`);
    assert(refreshCalls.length === 2, `${name}: failed Bridge launch refresh must be retried exactly once after manual retry, got ${refreshCalls.length}`);
    assert(retryUi.session === null, `${name}: rapid retry created a false session: ${retryUi.session}`);
    assert(retryUi.appShellHidden, `${name}: app shell opened despite repeated failed authentication`);
    assert(!retryUi.bootActionsHidden && retryUi.retryVisible, `${name}: retry controls disappeared after failed manual retry`);
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
    await runScenario({ name: 'bridge-refresh-rejected', refreshMode: 'reject' }),
    await runScenario({ name: 'bridge-refresh-timeout', refreshMode: 'timeout' })
  ];
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ ok: true, results }, null, 2));
  console.log(JSON.stringify({
    ok: true,
    outDir: path.relative(root, outDir),
    scenarios: results.map((result) => ({
      name: result.name,
      authCalls: result.apiCalls.filter((call) => call.pathname === '/api/auth').length,
      launchRefreshCalls: result.bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams').length,
      falseSessionCreated: result.retryUi.session !== null,
      retryVisible: result.retryUi.retryVisible
    }))
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}