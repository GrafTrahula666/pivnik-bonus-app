import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-reauth-newer-session-race-smoke');
const port = 4201;
const gatewayHost = 'vk-gateway.invalid';
const vkUserId = '4242';
const oldToken = 'old-race-session';
const newerToken = 'newer-independent-session';
const storageKey = `pivnik_vk_${vkUserId}_session`;
const signedLaunchQuery = `vk_app_id=54694987&vk_user_id=${vkUserId}&vk_ts=777777&vk_platform=mobile_iphone&sign=reauth-race-sign`;

const profile = {
  id: vkUserId, firstName: 'VK Race', lastName: 'Session', username: 'vk_race_session', provider: 'vk', role: 'user',
  balance: 777, termsAccepted: true, onboardingComplete: true, photoUrl: '', avatarSource: 'preset_male', avatarKey: null,
  profileFrame: 'none', monthlySpendCents: 0, totalSpendCents: 0, totalLiters: 0, beerProgressLiters: 0, beerGiftLiters: 0,
  status: { code: 'traveler', name: 'Путник', bonusPercent: 5, monthlySpendCents: 0, nextSpendCents: 1000000 },
  privacy: { publicProfile: true, showName: true, showAvatar: true, showMonthlySpend: true, showStats: true }
};
const payload = { token: oldToken, profile, statuses: [], design: null, promotions: [], shopItems: [], achievements: [], transactions: [], walletConfig: null, leaderboard: { entries: [], currentUser: null } };
const mime = new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.woff2','font/woff2']]);
const json = (body, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
let authCount = 0;
let expired = false;
let releaseFailedReauth;
const failedReauthGate = new Promise((resolve) => { releaseFailedReauth = resolve; });

page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('401') && !message.text().includes('503')) consoleErrors.push(message.text()); });
page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }));
await page.exposeFunction('__recordVkBridgeCall', (method) => bridgeCalls.push(method));

await page.route('**/*', async (route) => {
  const request = route.request();
  const requestUrl = new URL(request.url());
  if (requestUrl.hostname === '127.0.0.1') {
    if (requestUrl.pathname.endsWith('/vendor/vk-bridge.js')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams')return {vk_app_id:54694987,vk_user_id:${vkUserId},vk_ts:777777,vk_platform:'mobile_iphone',sign:'reauth-race-sign'};if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Race',photo_200:''};return {};}};` });
      return;
    }
    await route.continue();
    return;
  }
  if (requestUrl.hostname !== gatewayHost) return void await route.fulfill({ status: 204, body: '' });

  const method = request.method().toUpperCase();
  const pathname = requestUrl.pathname;
  const authorization = request.headers().authorization || '';
  apiCalls.push({ pathname, method, authorization });

  if (method === 'POST' && pathname === '/api/auth') {
    authCount += 1;
    if (expired) {
      await failedReauthGate;
      return void await route.fulfill(json({ error: 'auth temporarily unavailable' }, 503));
    }
    return void await route.fulfill(json(payload));
  }
  if (expired && authorization === `Bearer ${oldToken}` && (pathname === '/api/me/transactions' || pathname === '/api/achievements' || pathname === '/api/test-mutation')) {
    await delay(40);
    return void await route.fulfill(json({ error: 'Требуется вход в приложение.' }, 401));
  }
  if (pathname === '/api/bootstrap' || pathname === '/api/me') return void await route.fulfill(json(payload));
  if (pathname === '/api/me/transactions') return void await route.fulfill(json({ transactions: [] }));
  if (pathname === '/api/achievements') return void await route.fulfill(json({ achievements: [], earned: [], unannounced: [] }));
  if (pathname === '/api/leaderboard') return void await route.fulfill(json({ entries: [], currentUser: null }));
  if (pathname === '/api/promotions') return void await route.fulfill(json({ promotions: [] }));
  if (pathname === '/api/shop') return void await route.fulfill(json({ items: [] }));
  if (pathname === '/api/wheel/status') return void await route.fulfill(json({ freeAvailable: true, nextFreeAt: null }));
  await route.fulfill(json({}));
});

try {
  const response = await page.goto(`http://127.0.0.1:${port}/index.html?${signedLaunchQuery}`, { waitUntil: 'domcontentloaded' });
  assert(response?.status() === 200, `index returned ${response?.status()}`);
  await page.waitForFunction(() => document.querySelector('#appShell') && !document.querySelector('#appShell').classList.contains('hidden'), null, { timeout: 12000 });
  await page.waitForTimeout(1200);
  assert(authCount === 2, `initial auth count unexpected: ${authCount}`);
  assert(await page.evaluate((key) => localStorage.getItem(key), storageKey) === oldToken, 'initial scoped session missing');

  const recoveryStartIndex = apiCalls.length;
  expired = true;
  const resultsPromise = page.evaluate(async () => {
    const settle = (promise) => promise.then((value) => ({ rejected: false, value }), (error) => ({ rejected: true, status: Number(error?.status || 0), code: String(error?.code || ''), message: String(error?.message || '') }));
    return Promise.all([
      settle(window.api('/api/me/transactions')),
      settle(window.api('/api/achievements')),
      settle(window.api('/api/test-mutation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) }))
    ]);
  });

  for (let i = 0; i < 100 && authCount < 3; i += 1) await delay(20);
  assert(authCount === 3, `shared recovery auth did not start exactly once: ${authCount}`);
  assert(await page.evaluate((key) => localStorage.getItem(key), storageKey) === null, 'old session was not cleared before reauth');

  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: newerToken });
  assert(await page.evaluate((key) => localStorage.getItem(key), storageKey) === newerToken, 'independent newer session write failed');
  releaseFailedReauth();

  const results = await resultsPromise;
  await page.waitForTimeout(200);

  const recoveryCalls = apiCalls.slice(recoveryStartIndex);
  const authCalls = recoveryCalls.filter((call) => call.pathname === '/api/auth');
  const transactionCalls = recoveryCalls.filter((call) => call.pathname === '/api/me/transactions');
  const achievementCalls = recoveryCalls.filter((call) => call.pathname === '/api/achievements');
  const mutationCalls = recoveryCalls.filter((call) => call.pathname === '/api/test-mutation');
  const ui = await page.evaluate((key) => ({ session: localStorage.getItem(key), appShellHidden: document.querySelector('#appShell')?.classList.contains('hidden') ?? true, clientName: document.querySelector('#clientName')?.textContent || '' }), storageKey);

  assert(authCalls.length === 1, `failed shared recovery must call auth once, got ${authCalls.length}`);
  assert(transactionCalls.length === 1, `transactions must not replay after failed reauth, got ${transactionCalls.length}`);
  assert(achievementCalls.length === 1, `achievements must not replay after failed reauth, got ${achievementCalls.length}`);
  assert(mutationCalls.length === 1, `mutation must never replay, got ${mutationCalls.length}`);
  assert(results.every((result) => result.rejected), `all original requests must reject when reauth fails: ${JSON.stringify(results)}`);
  assert(results[0].status === 503 && results[1].status === 503, `GET callers must receive controlled reauth failure: ${JSON.stringify(results)}`);
  assert(results[2].status === 401, `mutation must retain original 401 without replay: ${JSON.stringify(results[2])}`);
  assert(ui.session === newerToken, `failed stale recovery erased newer independent session: ${ui.session}`);
  assert(!ui.appShellHidden, 'failed background recovery unexpectedly closed app shell');
  assert(ui.clientName.includes('VK Race'), `existing UI state was lost: ${ui.clientName}`);
  assert(bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams').length === 0, `post-boot recovery unexpectedly refreshed launch params: ${JSON.stringify(bridgeCalls)}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `failed requests: ${JSON.stringify(failedRequests)}`);

  const evidence = { ok: true, results, recoveryCalls, authCalls, transactionCalls, achievementCalls, mutationCalls, bridgeCalls, ui, pageErrors, consoleErrors, failedRequests };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(outDir, 'reauth-newer-session-race.png'), fullPage: true });
  console.log(JSON.stringify({ ok: true, authCalls: authCalls.length, preservedSession: ui.session === newerToken }, null, 2));
} catch (error) {
  releaseFailedReauth?.();
  const evidence = { ok: false, error: String(error?.stack || error?.message || error), authCount, apiCalls, bridgeCalls, pageErrors, consoleErrors, failedRequests };
  await fs.writeFile(path.join(outDir, 'failure.json'), JSON.stringify(evidence, null, 2));
  try { await page.screenshot({ path: path.join(outDir, 'reauth-newer-session-race-failed.png'), fullPage: true }); } catch (_) {}
  throw error;
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
