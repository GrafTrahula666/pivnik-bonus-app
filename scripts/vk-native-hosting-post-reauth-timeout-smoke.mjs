import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-post-reauth-timeout-smoke');
const port = 4203;
const gatewayHost = 'vk-gateway.invalid';
const vkUserId = '4242';
const oldToken = 'old-expired-session';
const newToken = 'new-recovered-session';
const storageKey = `pivnik_vk_${vkUserId}_session`;
const signedLaunchQuery = `vk_app_id=54694987&vk_user_id=${vkUserId}&vk_ts=999999&vk_platform=mobile_iphone&sign=post-reauth-timeout-sign`;
const profile = { id: vkUserId, firstName: 'VK Timeout', lastName: 'Recovery', username: 'vk_timeout_recovery', provider: 'vk', role: 'user', balance: 777, termsAccepted: true, onboardingComplete: true, photoUrl: '', avatarSource: 'preset_male', avatarKey: null, profileFrame: 'none', monthlySpendCents: 0, totalSpendCents: 0, totalLiters: 0, beerProgressLiters: 0, beerGiftLiters: 0, status: { code: 'traveler', name: 'Путник', bonusPercent: 5, monthlySpendCents: 0, nextSpendCents: 1000000 }, privacy: { publicProfile: true, showName: true, showAvatar: true, showMonthlySpend: true, showStats: true } };
const payload = (token) => ({ token, profile, statuses: [], design: null, promotions: [], shopItems: [], achievements: [], transactions: [], walletConfig: null, leaderboard: { entries: [], currentUser: null } });
const mime = new Map([['.html','text/html; charset=utf-8'],['.css','text/css; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.woff2','font/woff2']]);
const json = (body, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
let authCount = 0;
let expired = false;

page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('401')) consoleErrors.push(message.text()); });
await page.exposeFunction('__recordVkBridgeCall', (method) => bridgeCalls.push(method));

await page.route('**/*', async (route) => {
  const request = route.request();
  const requestUrl = new URL(request.url());
  if (requestUrl.hostname === '127.0.0.1') {
    if (requestUrl.pathname.endsWith('/vendor/vk-bridge.js')) {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: `window.vkBridge={send:async function(method){await window.__recordVkBridgeCall(method);if(method==='VKWebAppGetLaunchParams')return {vk_app_id:54694987,vk_user_id:${vkUserId},vk_ts:999999,vk_platform:'mobile_iphone',sign:'post-reauth-timeout-sign'};if(method==='VKWebAppGetUserInfo')return {id:${vkUserId},first_name:'VK',last_name:'Timeout',photo_200:''};return {};}};` });
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
    return void await route.fulfill(json(payload(expired ? newToken : oldToken)));
  }
  if (expired && authorization === `Bearer ${oldToken}` && pathname === '/api/me/transactions') {
    return void await route.fulfill(json({ error: 'Требуется вход в приложение.' }, 401));
  }
  if (expired && authorization === `Bearer ${newToken}` && pathname === '/api/me/transactions') {
    await sleep(700);
    try { await route.fulfill(json({ transactions: [] })); } catch (_) {}
    return;
  }
  if (pathname === '/api/bootstrap' || pathname === '/api/me') return void await route.fulfill(json(payload(expired ? newToken : oldToken)));
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
  const timedOut = await page.evaluate(async () => window.api('/api/me/transactions', { retries: 0, timeoutMs: 200 }).then(() => ({ rejected: false }), (error) => ({ rejected: true, status: Number(error?.status || 0), code: String(error?.code || ''), message: String(error?.message || '') })));
  assert(timedOut.rejected && timedOut.code === 'TIMEOUT', `post-recovery request must surface TIMEOUT: ${JSON.stringify(timedOut)}`);
  assert(authCount === 3, `timeout after recovery must not start a second re-auth: ${authCount}`);
  assert(await page.evaluate((key) => localStorage.getItem(key), storageKey) === newToken, 'timeout must not clear recovered scoped session');

  const followUp = await page.evaluate(async () => window.api('/api/promotions', { retries: 0, timeoutMs: 1000 }));
  assert(Array.isArray(followUp.promotions), `follow-up GET did not succeed: ${JSON.stringify(followUp)}`);

  const recoveryCalls = apiCalls.slice(recoveryStartIndex);
  const transactionCalls = recoveryCalls.filter((call) => call.pathname === '/api/me/transactions');
  const authCalls = recoveryCalls.filter((call) => call.pathname === '/api/auth');
  const followUpCalls = recoveryCalls.filter((call) => call.pathname === '/api/promotions');
  assert(authCalls.length === 1, `expected exactly one recovery auth, got ${authCalls.length}`);
  assert(transactionCalls.length === 2, `expected old-token 401 plus one new-token timed-out GET, got ${transactionCalls.length}`);
  assert(transactionCalls[0].authorization === `Bearer ${oldToken}`, `first recovery GET used unexpected token: ${JSON.stringify(transactionCalls)}`);
  assert(transactionCalls[1].authorization === `Bearer ${newToken}`, `post-recovery GET did not use new token: ${JSON.stringify(transactionCalls)}`);
  assert(!transactionCalls.slice(1).some((call) => call.authorization === `Bearer ${oldToken}`), 'old Bearer was reused after successful re-auth');
  assert(followUpCalls.length === 1 && followUpCalls[0].authorization === `Bearer ${newToken}`, `follow-up GET did not retain recovered in-memory token: ${JSON.stringify(followUpCalls)}`);
  assert(bridgeCalls.filter((method) => method === 'VKWebAppGetLaunchParams').length === 0, `post-boot recovery unexpectedly refreshed launch params: ${JSON.stringify(bridgeCalls)}`);
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);

  const evidence = { ok: true, timedOut, authCount, recoveryCalls, authCalls, transactionCalls, followUpCalls, bridgeCalls, pageErrors, consoleErrors };
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: path.join(outDir, 'post-reauth-timeout.png'), fullPage: true });
  console.log(JSON.stringify({ ok: true, authCount, timedOut: true, recoveredTokenRetained: true }, null, 2));
} catch (error) {
  const evidence = { ok: false, error: String(error?.stack || error?.message || error), authCount, apiCalls, bridgeCalls, pageErrors, consoleErrors };
  await fs.writeFile(path.join(outDir, 'failure.json'), JSON.stringify(evidence, null, 2));
  try { await page.screenshot({ path: path.join(outDir, 'post-reauth-timeout-failed.png'), fullPage: true }); } catch (_) {}
  throw error;
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
