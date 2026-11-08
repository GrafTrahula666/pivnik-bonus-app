// Full materialized client with fixture APIs; never sends production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
process.env.NODE_ENV = 'test';
process.env.PIVNIK_TEST_IMPORT = '1';
process.env.DATABASE_URL = 'postgres://fixture:fixture@127.0.0.1:1/fixture';
const { documentSecurityHeaders, renderAppIndex } = await import('../universal-server.js');

const root = process.cwd();
const output = path.join(root, 'artifacts/pivnik-lab-browser-smoke');
await fs.mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const tgIndex = await renderAppIndex('telegram');
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const isVk = u.searchParams.get('bundle') === 'vk' || req.headers.referer?.includes('bundle=vk');
    const base = isVk ? path.join(root, 'vk-hosting-build') : root;
    let name = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    if (name === 'run/') name += 'index.html';
    const file = path.resolve(base, isVk ? name : name.replace(/^run\//, 'minigames/pivnik-run/'));
    assert(file.startsWith(base + '/'));
    const data = name === 'index.html' && !isVk ? tgIndex : await fs.readFile(file);
    res.writeHead(200, { ...(name === 'index.html' && !isVk ? documentSecurityHeaders('telegram') : {}), 'content-type': mime[path.extname(name)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
const diagnostics = [];
let activePage;
try {
  for (const platform of ['telegram', 'vk']) {
    for (const width of [320, 390, 430, 1280]) {
      const name = `${platform}-${width}`;
      const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      activePage = page;
      const errors = [];
      const calls = [];
      let leagueMode = 'full';
      let chessAvailable = false;
      let inquirySaved = false;
      const leader = { rank: 1, name: 'Лидер QA', spend: 1234, showAvatar: false };
      const wheelStatus = { freeAvailable: true, nextFreeAt: null };
      const spin = { kind: 'free', prize: { code: 'bonus-20' }, createdAt: '2026-11-01T10:00:00Z' };
      const earned = { code: 'first', rarity: 'common', title: 'Первая покупка', description: 'Условие первой покупки', earned: true, rewardBonus: 5 };
      const locked = { code: 'next', rarity: 'common', title: 'Следующая покупка', earned: false, progress: { percent: 25, current: 1, target: 4, label: '1 из 4' } };
      diagnostics.length = 0;
      page.on('pageerror', e => { errors.push(e.message); diagnostics.push(e.message); });
      page.on('console', msg => {
        if (msg.type() === 'error') diagnostics.push(msg.text());
      });
      const profile = { id: '4242', provider: platform, firstName: 'Lab', lastName: 'QA', role: 'user', balance: 321, termsAccepted: true, onboardingComplete: true, avatarSource: 'preset_male', profileFrame: 'none', totalLiters: 12.5, beerProgressLiters: 3, beerGiftLiters: 0, status: { name: 'Путник', bonusPercent: 5 }, privacy: {} };
      const payload = { token: 'fixture-session', profile, statuses: [], design: null };
      await page.addInitScript(() => {
        window.Telegram = { WebApp: { initData: 'fixture-init', ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}, BackButton: { onClick(handler) { window.fixtureTelegramBack = handler; }, show() {}, hide() {} } } };
      });
      await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.endsWith('/vendor/vk-bridge.js')) {
          return route.fulfill({ contentType: 'text/javascript', body: `window.vkBridge={send:async(method)=>method==='VKWebAppGetLaunchParams'?{vk_app_id:54694987,vk_user_id:4242,vk_ts:123456,vk_platform:'mobile_iphone',sign:'fixture'}:method==='VKWebAppGetUserInfo'?{id:4242,first_name:'Lab',last_name:'QA'}:{}};` });
        }
        if (url.pathname.startsWith('/api/')) {
          calls.push({ path: url.pathname, method: request.method(), body: request.postData(), auth: request.headers().authorization });
          let body = {};
          if (['/api/auth', '/api/bootstrap', '/api/me'].includes(url.pathname)) body = payload;
          if (url.pathname === '/api/me/qr') body = { shortCode: 'QA4242', image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' };
          let status = 200;
          if (url.pathname === '/api/achievements') body = { achievements: [earned, locked], profileAchievements: [earned] };
          if (url.pathname === '/api/leaderboard/monthly') {
            status = leagueMode === 'error' ? 503 : 200;
            body = { month: 'ноябрь 2026 г.', leaders: leagueMode === 'full' ? [leader] : [] };
            if (width === 390 && leagueMode === 'error') await new Promise(resolve => setTimeout(resolve, 300));
          }
          if (url.pathname === '/api/leaderboard/seasons') body = { seasons: [{ month: 'октябрь 2026 г.', leaders: [leader] }] };
          if (url.pathname === '/api/run/leaderboard') body = { leaders: [], me: null, total: 0 };
          if (url.pathname === '/api/run/start') body = { ticket: 'fixture-run-ticket' };
          if (url.pathname === '/api/wheel/status') body = wheelStatus;
          if (url.pathname === '/api/wheel/history') body = { spins: [spin] };
          if (url.pathname === '/api/wheel/spin') body = { spin, status: { freeAvailable: false, canAffordPaid: false }, account: { balance: 341 } };
          if (url.pathname === '/api/lab/chess') {
            status = chessAvailable ? 200 : 503;
            body = chessAvailable ? { url: 'https://ruslanych-ai-production.up.railway.app/' } : { error: 'Недоступно' };
          }
          if (url.pathname === '/api/shop/inquiries') body = inquirySaved ? { ok: true, inquiry: { id: '72' } } : { ok: true, inquiry: { id: 'preview' } };
          return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        }
        if (url.origin === 'https://ruslanych-ai-production.up.railway.app') return route.fulfill({ contentType: 'text/html', body: '<title>Chess fixture</title><p>Chess fixture</p>' });
        if (url.origin === origin) return route.continue();
        return route.fulfill({ status: 204, body: '' });
      });
      await page.goto(`${origin}/?bundle=${platform === 'vk' ? 'vk' : 'tg'}&vk_app_id=54694987&vk_user_id=4242&vk_ts=123456&vk_platform=mobile_iphone&sign=fixture`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !document.querySelector('#appShell').classList.contains('hidden') && document.querySelector('.mazut-home'));
      await page.waitForFunction(() => document.querySelector('#clientBalance')?.textContent === '321', null, { timeout: 5000 });
      await page.locator('#heroQrButton').click();
      await page.waitForFunction(() => document.querySelector('#qrModal').classList.contains('open') && document.querySelector('#qrToken').textContent === 'QA4242');
      await page.locator('#qrModal [data-close="qrModal"]').click();
      await page.screenshot({ path: path.join(output, `${name}-home.png`), fullPage: false });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name}: horizontal overflow`);
      const waitFor = (selector) => page.locator(selector).waitFor({ state: 'visible' });
      const open = (id) => waitFor(`#${id}[open]`);
      const close = (id) => page.locator(`#${id}[open] button[type=submit]`).click();
      const screen = (id) => waitFor(`[data-screen="${id}"].active`);
      const textIs = (selector, value) => page.waitForFunction(({selector, value}) => document.querySelector(selector)?.textContent.includes(value), {selector, value});
      const authCalls = () => calls.filter(c => c.path === '/api/auth' || c.path === '/api/bootstrap').length;
      const initialAuthCalls = authCalls();

      await page.locator('.mazut-lab').click();
      await screen('spaceverse-lab');
      assert.equal(await page.locator('.lab-projector:visible').count(), 5);
      await page.locator('#labGuide').click();
      await page.locator('#labWelcomeContinue').click();
      await page.locator('#labPlayground').click();
      await page.locator('#labWheel').click();
      await waitFor('#wheelDisk');
      await textIs('#wheelHistory', '20 бонусов');
      await page.locator('#openWheelRulesButton').click();
      await waitFor('#wheelRulesModal.open');
      if (platform === 'telegram') await page.evaluate(() => window.fixtureTelegramBack());
      else await page.keyboard.press('Escape');
      await page.locator('#wheelRulesModal.open').waitFor({ state: 'hidden' });
      if (width === 390) {
        await page.locator('#wheelSpinButton').click();
        await textIs('#wheelResultTitle', '20 бонусов');
        assert.equal(await page.locator('#wheelSpinButton').isDisabled(), true);
        const spins = calls.filter(c => c.path === '/api/wheel/spin');
        assert.equal(spins.length, 1);
        assert.match(JSON.parse(spins[0].body).requestKey, /^[a-z0-9-]+$/i);
      }
      await page.locator('#wheelBackButton').click();
      await open('labPlaygroundDialog');
      if (width === 390) {
        await page.locator('#labChessLink').click();
        await textIs('#labGameStatus', 'Шахматы временно недоступны');
        await close('labGameDialog');
        chessAvailable = true;
        await page.locator('#labChessLink').click();
        await waitFor('#labGameDialog iframe');
        await page.frameLocator('#labGameDialog iframe').getByText('Chess fixture').waitFor({ state: 'attached' });
        await close('labGameDialog');
        await page.locator('#labRun').click();
        const run = page.frameLocator('#labGameDialog iframe');
        await run.locator('#play').waitFor();
        await run.locator('#exitApp').click();
        await page.locator('#labGameDialog[open]').waitFor({ state: 'hidden' });
        await open('labPlaygroundDialog');
        await page.locator('#labRun').click();
        await run.locator('#play').click();
        await run.locator('#hud').waitFor();
        const lane = await run.locator('#game').evaluate(() => window.__run.g.lane);
        await run.locator('#game').press('ArrowLeft');
        assert.equal(await run.locator('#game').evaluate(() => window.__run.g.lane), lane - 1);
        await run.locator('#game').press('ArrowUp');
        if (platform === 'telegram') {
          assert(calls.some(c => c.path === '/api/run/start' && c.auth === 'Bearer fixture-session'));
        }
        await close('labGameDialog');
        await page.locator('#labGameDialog iframe').waitFor({ state: 'detached' });
      }
      await close('labPlaygroundDialog');

      await page.locator('#labPantheon').click();
      if (width === 390) leagueMode = 'error';
      await page.locator('#labLeague').click();
      if (width === 390) {
        await waitFor('#leaderboardList[aria-busy=true]');
        await textIs('#leaderboardList', 'Не удалось загрузить рейтинг');
        leagueMode = 'empty';
        await page.locator('#retryLeaderboard').click();
        await textIs('#leaderboardList', 'Пока нет покупок');
        await page.locator('#leagueBackButton').click();
        await screen('spaceverse-lab');
        await page.locator('#labPantheon').click();
        leagueMode = 'full';
        await page.locator('#labLeague').click();
      }
      await textIs('#leaderboardList', 'Лидер QA');
      await page.locator('#openLeagueSeasons').click();
      await textIs('#leagueSeasonsList', 'октябрь 2026 г.');
      await page.locator('#leagueSeasonsBackButton').click();
      await screen('league');
      await page.locator('#leagueBackButton').click();
      await screen('spaceverse-lab');

      await page.locator('#labPantheon').click();
      await page.locator('#labAchievements').click();
      await waitFor('#achievementCatalog .earned[data-achievement-code=first]');
      await textIs('#achievementCatalog .locked[data-achievement-code=next]', '25%');
      await page.locator('[data-achievement-code=first] summary').click();
      await textIs('[data-achievement-code=first] details[open] p', 'Условие первой покупки');
      await page.locator('#achievementsModal [data-achievement-tab=rare]').click();
      await textIs('#achievementCatalog', 'пока нет доступных достижений');
      await page.keyboard.press('Escape');
      await page.locator('#achievementsModal.open').waitFor({ state: 'hidden' });

      await page.locator('#labShop').click();
      await textIs('#labShopDialog', 'Мы в скором времени добавим ассортимент');
      await page.goBack();
      await page.locator('#labShopDialog[open]').waitFor({ state: 'hidden' });
      await screen('spaceverse-lab');

      await page.locator('#labBusiness').click();
      await waitFor('#spaceverseBusinessDetails');
      await page.locator('#spaceverseBusinessBack').click();
      await screen('spaceverse-lab');
      await page.locator('#labPartner').click();
      await waitFor('#spaceversePartnerDetails');
      if (width === 390) {
        await page.locator('#spaceverseLeadSubmit').click();
        await textIs('#spaceverseLeadError:not([hidden])', 'Проверьте номер');
        assert.equal(calls.filter(c => c.path === '/api/shop/inquiries').length, 0);
        await page.locator('#spaceverseLeadPhone').fill('+7 999 123-45-67');
        await page.locator('#spaceverseLeadSubmit').click();
        await textIs('#spaceverseLeadError', 'Сервер не подтвердил');
        await page.locator('#spaceverseLeadSuccess').waitFor({ state: 'hidden' });
        inquirySaved = true;
        await page.locator('#spaceverseLeadSubmit').click();
        await waitFor('#spaceverseLeadSuccess:not(.hidden)');
      }
      await page.locator('#spaceverseBusinessBack').click();
      await screen('spaceverse-lab');
      await page.screenshot({ path: path.join(output, `${name}-lab.png`) });
      await page.locator('#labBack').click();
      await screen('client');
      await page.waitForFunction(() => !history.state?.pivnikLab);
      await page.locator('.mazut-lab').click();
      await screen('spaceverse-lab');
      if (platform === 'telegram') await page.evaluate(() => window.fixtureTelegramBack());
      else await page.goBack();
      await screen('client');
      assert.equal(authCalls(), initialAuthCalls, 'Lab navigation must keep the session');
      assert.equal(context.pages().length, 1, 'Lab navigation must stay in the current page');
      assert.equal(await page.locator('video[data-src*="lab"]').count(), 0);
      assert.deepEqual(errors, [], `${name}: browser exceptions`);
      assert(calls.some(c => c.path === '/api/me/qr' && c.method === 'POST'), 'Real QR action must be retained');
      assert(!calls.some(c => /staff\/transactions|shop\/purchase/.test(c.path)), 'Navigation must not move money');
      results.push({ name, passed: true, checks: 'QR, five projectors, nested Back, wheel, League archive, achievements, Business/Partner, Shop, repeat entry; extended games and errors at 390 px' });
      await context.close();
      activePage = null;
      console.log(`PASS ${name}`);
    }
  }
} catch (error) {
  if (activePage) {
    console.error(diagnostics);
    await activePage.screenshot({ path: path.join(output, 'failure.png') });
    console.error(await activePage.evaluate(() => ({ active: document.querySelector('.screen.active')?.dataset.screen, dialogs: [...document.querySelectorAll('dialog[open]')].map(e => e.id), buttons: ['heroQrButton', 'openSpaceverseLab'].map(id => { const e = document.getElementById(id); return { id, display: getComputedStyle(e).display, rect: e.getBoundingClientRect().toJSON() }; }) })));
  }
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
