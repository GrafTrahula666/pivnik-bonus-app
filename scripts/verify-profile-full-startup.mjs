// Manual loopback diagnostic: complete client scripts, fixture HTTP and SDKs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gateway = await readFile(path.join(root, 'universal-server.js'), 'utf8');
const from = gateway.indexOf('export async function renderAppIndex(');
const to = gateway.indexOf('\n}\n', from);
assert.ok(from >= 0 && to > from);
const indexRenderer = gateway.slice(from, to + 3).replace('export ', '');
const context = vm.createContext({ fs: { readFile }, path, __dirname: root });
vm.runInContext(indexRenderer + '\nglobalThis.render=renderAppIndex;', context);
const shells = { telegram: await context.render('telegram'), vk: await context.render('vk') };
const fixtures = {
  '/api/shift/current': { shift: null }, '/api/promotions': { promotions: [] },
  '/api/shop/catalog': { items: [] }, '/api/leaderboard/monthly': { month: '2026-10', leaders: [], me: null },
  '/api/achievements': { achievements: [], profileAchievements: [], unannouncedAchievements: [] },
  '/api/shop/contact': { ownerName: 'Fixture', ownerUsername: null },
  '/api/wallet/config': { appleAvailable: false, googleAvailable: false, fallbackAvailable: true },
  '/api/wheel/status': { available: false, nextSpinAt: null, prizes: [] }
};
const sdk = `window.Telegram={WebApp:{initData:'fixture-launch',initDataUnsafe:{user:{id:123}},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},onEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}},MainButton:{hide(){}},HapticFeedback:{impactOccurred(){}}}};`;
const vkSdk = `window.vkBridge={send:async(name)=>name==='VKWebAppGetLaunchParams'?{vk_user_id:'123',vk_app_id:'123',sign:'fixture'}:name==='VKWebAppGetUserInfo'?{id:123,first_name:'Fixture',last_name:'Profile'}:{result:true},subscribe(){},supports(){return true}};`;
let platform = 'telegram', phase = 'success', secondaryFailure = false, requests = [], violations = [];
function payload(spend) {
  return { profile: { id: 'fixture', firstName: 'Fixture', lastName: 'Profile', platform,
    role: 'client', balance: 17, spend12m: spend, termsAccepted: true,
    status: { name: 'Путник', bonusPercent: 1, minSpend: 0, nextSpend: 100 }, beer: {},
    achievements: [], unannouncedAchievements: [] }, statuses: [{ name: 'Путник', min: 0, bonusPercent: 1 }] };
}
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      requests.push({ path: pathname, method: req.method });
      res.setHeader('Content-Type', 'application/json');
      // The original VK wrapper emits diagnostic telemetry. Capture locally only.
      if (pathname === '/api/diagnostics/vk-startup' && req.method === 'POST') {
        for await (const chunk of req) void chunk;
        return res.end(JSON.stringify({ ok: true }));
      }
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.authorization, 'Bearer fixture-session');
      assert.equal(req.headers['x-pivnik-platform'], platform);
      if (pathname === '/api/bootstrap') return res.end(JSON.stringify(payload(0)));
      if (pathname === '/api/me') {
        await new Promise(resolve => setTimeout(resolve, 180));
        if (phase === 'network') return req.socket.destroy();
        if (['401', '403', '503'].includes(phase)) {
          res.statusCode = Number(phase); return res.end(JSON.stringify({ error: 'fixture detail' }));
        }
        return res.end(JSON.stringify(phase === 'invalid' ? { profile: null } : payload(125)));
      }
      assert.ok(Object.hasOwn(fixtures, pathname), 'Unexpected fixture endpoint ' + pathname);
      if (secondaryFailure && pathname === '/api/promotions') {
        res.statusCode = 503; return res.end(JSON.stringify({ error: 'fixture secondary outage' }));
      }
      return res.end(JSON.stringify(fixtures[pathname]));
    }
    if (pathname === '/' || pathname === '/vk') {
      res.setHeader('Content-Type', 'text/html'); return res.end(shells[platform]);
    }
    if (pathname === '/vendor/vk-bridge.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(vkSdk); }
    const file = path.resolve(root, '.' + pathname);
    assert.ok(file.startsWith(root + path.sep));
    res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' :
      pathname.endsWith('.png') ? 'image/png' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch (error) {
    if (req.url.startsWith('/api/')) violations.push(error.message);
    res.writeHead(500); res.end('Fixture failure');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let browser;
try {
  for (platform of ['telegram', 'vk']) for (const width of [390, 1440]) {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage',
        '--single-process', '--no-zygote', '--disable-gpu', '--disable-software-rasterizer', '--use-gl=disabled']
    } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() :
        route.request().url().startsWith('https://telegram.org/js/telegram-web-app.js') ?
          route.fulfill({ contentType: 'text/javascript', body: sdk }) : route.abort());
      await page.addInitScript(() => {
        localStorage.setItem('pivnik_tg_session', 'fixture-session');
        localStorage.setItem('pivnik_vk_123_session', 'fixture-session');
        window.__fixtureMeFetches = 0;
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (...args) => {
          if (new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href).pathname === '/api/me') window.__fixtureMeFetches++;
          return nativeFetch(...args);
        };
      });
      for (const scenario of ['success', '401', '403', '503', 'invalid', 'network', 'secondary', '503-secondary']) {
        phase = scenario === 'secondary' ? 'success' : scenario === '503-secondary' ? '503' : scenario;
        secondaryFailure = scenario.includes('secondary');
        const primarySuccess = phase === 'success';
        requests = []; violations = [];
        process.stderr.write(`Checking ${platform}/${width}/${scenario}\n`);
        const errors = [], coreErrors = [], optionalErrors = [];
        const onError = error => errors.push(error.message);
        const onConsole = message => {
          if (message.text().startsWith('Optional startup data skipped:')) optionalErrors.push(message.text());
          if (/Core profile render skipped:|Boot failed:|Unhandled promise rejection:|Client error:/.test(message.text())) coreErrors.push(message.text());
        };
        page.on('pageerror', onError); page.on('console', onConsole);
        await page.goto(origin + (platform === 'vk' ? '/vk?vk_user_id=123&vk_app_id=123&sign=fixture' : '/'));
        await page.waitForFunction(() => document.querySelector('#bootScreen').classList.contains('hidden'));
        await page.waitForFunction(() => ['ready', 'error', 'denied'].includes(document.querySelector('#profileRefreshNotice').dataset.state));
        await page.waitForFunction(() => state.achievementsLoaded && state.leaderboard && state.walletConfig && state.wheel.status);
        assert.equal(await page.evaluate(() => state.token), 'fixture-session');
        assert.equal(await page.evaluate(() => state.profile.balance), 17);
        assert.equal(await page.evaluate(() => state.profile.spend12m), primarySuccess ? 125 : 0);
        assert.equal(await page.evaluate(() => window.__fixtureMeFetches), 1);
        for (const endpoint of Object.keys(fixtures)) assert.ok(requests.some(r => r.path === endpoint), endpoint);
        if (secondaryFailure) {
          await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Часть разделов обновится при следующем открытии');
          assert.equal(optionalErrors.length, 1);
          assert.equal(requests.filter(r => r.path === '/api/promotions').length, 2, 'existing optional GET retry policy');
          assert.equal(await page.evaluate(() => state.promotions.length), 0);
        }
        if (!primarySuccess) {
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#toast')).opacity === '0');
          const banner = page.locator('#profileRefreshNotice');
          assert.equal(await banner.isVisible(), true); assert.match(await banner.textContent(), /ранее загруженные данные/);
          assert.equal(await banner.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
          const rect = await banner.boundingBox(); assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width + 1);
        } else assert.equal(await page.locator('#profileRefreshNotice').isVisible(), false);
        phase = 'success';
        await page.locator('#refreshButton').click();
        await page.waitForFunction(() => document.querySelector('#profileRefreshNotice').dataset.state === 'loading');
        await page.waitForFunction(() => state.profile.spend12m === 125 && document.querySelector('#profileRefreshNotice').dataset.state === 'ready');
        assert.equal(await page.locator('#profileRefreshNotice').isVisible(), false);
        assert.equal(await page.evaluate(() => window.__fixtureMeFetches), 2);
        assert.equal(await page.evaluate(() => state.token), 'fixture-session');
        if (secondaryFailure) {
          assert.equal(requests.filter(r => r.path === '/api/promotions').length, 2, 'manual profile refresh does not restart boot-only secondary jobs');
          secondaryFailure = false;
          const beforeReload = requests.filter(r => r.path === '/api/promotions').length;
          await page.reload();
          await page.waitForFunction(() => bootCompleted && state.profile?.spend12m === 125 && state.leaderboard && state.achievementsLoaded && state.wheel.status);
          assert.equal(requests.filter(r => r.path === '/api/promotions').length - beforeReload, 1, 'reopening retries the original secondary job');
          assert.equal(await page.locator('#profileRefreshNotice').isVisible(), false);
          assert.equal(await page.evaluate(() => state.token), 'fixture-session');
          assert.equal(optionalErrors.length, 1, 'reopening does not produce another optional error');
        }
        assert.deepEqual(violations, []); assert.deepEqual(errors, []); assert.deepEqual(coreErrors, []);
        assert.ok(requests.every(r => r.method === 'GET' || r.path === '/api/diagnostics/vk-startup'));
        page.removeListener('pageerror', onError); page.removeListener('console', onConsole);
        results.push(`${platform}/${width}: full scripts ${scenario} -> secondary reads -> manual recovery${scenario.includes('secondary') ? ' -> reopen' : ''}`);
      }
    } finally { await browser.close(); browser = null; }
  }
  const hashes = {};
  for (const file of ['app.js', 'account-link.js', 'vk-platform.js', 'red-cosmos-v2.js', 'index.html', 'styles.css']) {
    hashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
  }
  console.log(JSON.stringify({ passed: results.length, cases: results, hashes,
    limits: 'Original renderAppIndex and complete linked client scripts with local HTTP payload fixtures and SDK adapters. Warm fixture token; no cold signed auth, DB/server route composition, native VK hosting, real tenants or provider proof. VK diagnostic POST captured locally only.' }, null, 2));
} finally {
  if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
