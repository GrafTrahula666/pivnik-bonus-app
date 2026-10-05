// Manual, loopback-only browser diagnostic. Does not start production servers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'app.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start); return source.slice(from, to);
}
function original(start) { return section(start, '\n}\n') + '\n}'; }
const functions = ['async function boot(', 'async function finishBoot(', 'function showBootActions(',
  'function setProfileRefreshState(', 'function clearBootError(', 'async function refreshMe(', 'async function hydrateAfterBoot(',
  'function schedulePostBootHydration(', 'function renderCoreProfile(', 'function applyProfilePayload(',
  'function renderProfile(', 'function renderStatuses(', 'function currentLevelIndex(', 'function toast(',
  'function closeModal('].map(original).join('\n');
const helpers = section('const $ =', 'const AVATAR_OPTIONS =');
const transport = section('function timeoutError(', 'function openModal(');
const refreshBinding = source.split('\n').find(line => line.startsWith("$('#refreshButton').addEventListener"));
assert.ok(refreshBinding);
const shell = (await readFile(path.join(root, 'index.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
let platform = 'telegram', phase = 'success', requests = [];
const profile = spend => ({ id: 'fixture', firstName: 'Fixture', lastName: 'Profile', platform,
  role: 'client', balance: 17, spend12m: spend, termsAccepted: false,
  status: { name: 'Путник', bonusPercent: 1, minSpend: 0, nextSpend: 100 }, beer: {} });
const payload = spend => ({ profile: profile(spend), statuses: [{ name: 'Путник', min: 0, bonusPercent: 1 }] });
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      requests.push({ path: pathname, method: req.method, platform: req.headers['x-pivnik-platform'] });
      assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer fixture-session');
      assert.equal(req.headers['x-pivnik-platform'], platform);
      res.setHeader('Content-Type', 'application/json');
      if (pathname === '/api/bootstrap') return res.end(JSON.stringify(payload(0)));
      assert.equal(pathname, '/api/me');
      await new Promise(resolve => setTimeout(resolve, 150));
      if (phase === 'network') return req.socket.destroy();
      if (['401', '403', '503'].includes(phase)) {
        res.statusCode = Number(phase); return res.end(JSON.stringify({ error: 'private fixture provider/SQL details' }));
      }
      return res.end(JSON.stringify(phase === 'invalid' ? { profile: null } : payload(125)));
    }
    const file = path.resolve(root, '.' + pathname);
    if (pathname !== '/' && !file.startsWith(root + path.sep)) throw Error('Fixture path denied');
    res.setHeader('Content-Type', pathname === '/' ? 'text/html' : pathname.endsWith('.css') ? 'text/css' :
      pathname.endsWith('.png') ? 'image/png' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
    res.end(pathname === '/' ? shell : await readFile(file));
  } catch (error) { res.writeHead(500); res.end('Fixture request failed'); }
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
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      for (const scenario of ['success', '401', '403', '503', 'invalid', 'network']) {
        phase = scenario; requests = [];
        await page.goto(origin + '/');
        const errors = [], renderErrors = [];
        const onError = error => errors.push(error.message); page.on('pageerror', onError);
        const onConsole = message => { if (message.text().startsWith('Core profile render skipped:')) renderErrors.push(message.text()); };
        page.on('console', onConsole);
        await page.addScriptTag({ content: `const state={token:'fixture-session', profile:null, statuses:[]};
          let fixtureFetches=0; const nativeFetch=window.fetch.bind(window);
          window.fetch=(...args)=>{fixtureFetches++;return nativeFetch(...args);};
          const IS_VK=${platform === 'vk'}, PLATFORM_NAME='${platform}', APP_VERSION='fixture', API_TIMEOUT_MS=3000;
          let bootInFlight=null, bootCompleted=false; const bootStartedAt=performance.now(), BOOT_MIN_MS=0;
          const safeStorage={remove() {}}, refreshTelegramBridge=()=>null;
          async function authenticate() { throw new Error('Unexpected authentication fixture path'); }
          function applyTelegramChrome() {} function applyDesign() {} function renderAvatarInto() {}
          function renderAchievements() {} function renderBeer() {} function renderCurrentShift() {}
          function activeStaffName() { return 'Fixture'; }
          function switchScreen() { throw new Error('Unexpected fixture screen switch'); }
          async function loadSecondaryData() {} async function loadWheelStatus() {}
          ${helpers}\n${transport}\n${functions}\n${refreshBinding}
          window.fixture={state,boot,fetchCount:()=>fixtureFetches};` });
        await page.evaluate(() => fixture.boot());
        if (scenario === 'success') await page.waitForFunction(() => fixture.state.profile?.spend12m === 125);
        else await page.waitForFunction(() => document.querySelector('#toast').classList.contains('show'));
        const view = await page.evaluate(() => ({ profile: fixture.state.profile, token: fixture.state.token,
          spend: document.querySelector('#statsSpend12m').textContent,
          toast: document.querySelector('#toast').textContent,
          shown: document.querySelector('#toast').classList.contains('show'),
          bootHidden: document.querySelector('#bootScreen').classList.contains('hidden') }));
        assert.equal(view.bootHidden, true); assert.equal(view.token, 'fixture-session');
        assert.equal(view.profile.balance, 17); assert.equal(view.profile.spend12m, scenario === 'success' ? 125 : 0);
        assert.equal(view.spend, scenario === 'success' ? '125 ₽' : '0 ₽');
        assert.equal(await page.evaluate(() => fixture.fetchCount()), 2, 'one bootstrap and one scheduled hydration API attempt');
        // Chromium can transparently repeat a GET on a closed socket; the API
        // still calls fetch once for hydration (retries=0), and no write exists.
        if (scenario === 'network') assert.ok(requests.length >= 2);
        else assert.equal(requests.length, 2);
        if (scenario === 'success') { assert.equal(view.shown, false); assert.equal(await page.locator('#profileRefreshNotice').isVisible(), false); }
        else {
          assert.match(view.toast, /ранее загруженные данные/); assert.equal(view.toast.includes('private'), false);
          assert.equal(view.toast.includes('Откройте приложение заново'), ['401', '403'].includes(scenario));
          assert.equal(await page.locator('#toast').isVisible(), true);
          await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'));
          assert.equal(await page.locator('#profileRefreshNotice').isVisible(), true);
          assert.match(await page.locator('#profileRefreshNotice').textContent(), /ранее загруженные данные/);
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#toast')).opacity === '0');
          assert.equal(await page.locator('#profileRefreshNotice').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'notice is above shell background');
          if (scenario === '503' && platform === 'telegram') await page.screenshot({ path: path.join(root, '..', 'profile-persistent-validation', `notice-${width}.png`) });
          const rect = await page.locator('#profileRefreshNotice').boundingBox();
          assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width + 1 && rect.y >= 0 && rect.y + rect.height <= 900);
        }
        if (scenario !== 'success') {
          await page.locator('#refreshButton').click();
          await page.waitForFunction(() => ['error', 'denied'].includes(document.querySelector('#profileRefreshNotice').dataset.state));
          assert.equal(await page.evaluate(() => fixture.state.profile.spend12m), 0);
          assert.equal(await page.evaluate(() => fixture.fetchCount()), ['503', 'network'].includes(scenario) ? 4 : 3, 'existing manual GET retry policy');
        }
        const beforeManual = requests.length;
        phase = 'success';
        await page.locator('#refreshButton').click();
        await page.waitForFunction(() => document.querySelector('#profileRefreshNotice').dataset.state === 'loading');
        await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Данные обновлены');
        assert.equal(await page.evaluate(() => fixture.state.profile.spend12m), 125);
        assert.equal(await page.locator('#profileRefreshNotice').isVisible(), false);
        assert.equal(requests.length - beforeManual, 1, 'existing manual refresh uses one successful GET');
        assert.equal(await page.evaluate(() => fixture.fetchCount()), scenario === 'success' ? 3 : ['503', 'network'].includes(scenario) ? 5 : 4);
        assert.deepEqual(errors, []); assert.deepEqual(renderErrors, []);
        page.removeListener('pageerror', onError); page.removeListener('console', onConsole);
        results.push(`${platform}/${width}: ${scenario} boot -> scheduled hydration -> manual refresh`);
      }
    } finally { await browser.close(); browser = null; }
  }
  console.log(JSON.stringify({ passed: results.length, cases: results,
    hydrationHash: createHash('sha256').update(original('async function hydrateAfterBoot(')).digest('hex'),
    sourceHash: createHash('sha256').update(functions + helpers + transport + refreshBinding).digest('hex'),
    limits: 'Original boot/finish/scheduler/profile renderer/API/toast/refresh listener, local fixture HTTP. Bridge/auth/design/avatar/beer/achievement/shift/secondary adapters. Stored fixture token, not real provider auth or SQL. No full app scripts, live identity, tenant or production proof.' }, null, 2));
} finally {
  if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
