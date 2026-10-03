import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts', 'league-seasons-browser-smoke');
await fs.mkdir(output, { recursive: true });
const source = await fs.readFile(path.join(root, 'app.js'), 'utf8');
const region = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing client region: ${start}`);
  return source.slice(from, to);
};
const client = [
  region('const $ =', 'const AVATAR_OPTIONS'),
  region('function avatarAssetUrl', 'function profileDraftFromCurrent'),
  region('function switchScreen(', 'function currentLevelIndex'),
  region('function renderLeaderboard()', 'function updateResolvedBeer('),
  ...source.split('\n').filter(line => /^\$\('#(openLeagueSeasons|leagueSeasonsBackButton|retryLeagueSeasons)'\)/.test(line))
].join('\n');
const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const server = http.createServer(async (req, res) => {
  try {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (file.includes('..')) throw new Error('Invalid path');
    res.setHeader('Content-Type', ({ '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png' })[path.extname(file)] || 'text/javascript');
    res.end(file === 'index.html' ? html : await fs.readFile(path.join(root, file)));
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? {
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote', '--disable-gpu', '--disable-software-rasterizer', '--use-gl=disabled']
} : {}) });
try {
  const leader = (rank, name, spend, extras = {}) => ({ rank, name, spend, showAvatar: true, avatarSource: 'preset_male', profileFrame: 'none', ...extras });
  const fixture = { seasons: [
    { monthCode: '2026-09', month: 'сентябрь 2026 г.', leaders: [leader(1, 'Кирилл', 25670, { profileFrame: 'gold-bars', isMe: true }), leader(2, 'SevTrout', 12400, { profileFrame: 'money' }), leader(3, 'Скрытый гость', null, { showAvatar: false })] },
    { monthCode: '2026-08', month: 'август 2026 г.', leaders: [leader(1, 'Александра', 18990), leader(2, 'Владислав', 12300), leader(3, 'Анна', 9450)] },
    { monthCode: '2026-07', month: 'июль 2026 г.', leaders: [leader(1, 'Павел', 3400)] }
  ] };
  const results = [];
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  for (const platform of ['telegram', 'vk']) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.fulfill({ status: 204, body: '' }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(platform => {
      document.body.classList.add(`platform-${platform}`);
      document.querySelector('#bootScreen').remove();
      document.querySelector('#appShell').classList.remove('hidden');
      document.querySelectorAll('.screen').forEach(e => e.classList.toggle('active', e.dataset.screen === 'league'));
    }, platform);
    await page.addScriptTag({ content: `
      const state = { profile: { role: 'client' }, leaderboard: { month: 'октябрь 2026 г.', leaders: [], me: null }, leagueSeasons: null, leagueSeasonsLoading: false, leagueSeasonsError: '' };
      window.archiveFixture = ${JSON.stringify(fixture)};
      window.archiveMode = 'success'; window.archiveCalls = 0;
      const api = async (endpoint) => {
        if (endpoint !== '/api/leaderboard/seasons') throw new Error('Unexpected endpoint');
        window.archiveCalls++;
        await new Promise(resolve => setTimeout(resolve, 80));
        if (window.archiveMode === 'error') throw new Error('Network unavailable');
        return window.archiveMode === 'empty' ? { seasons: [] } : window.archiveFixture;
      };
      ${client}
      renderLeaderboard();
    ` });
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 812 });
      await page.locator('#openLeagueSeasons').click();
      await page.waitForFunction(() => document.querySelector('#leagueSeasonsList').getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('.screen.active').getAttribute('data-screen'), 'league-seasons');
      assert.equal(await page.locator('#leagueSeasonsList .league-season').count(), 3);
      assert.equal(await page.locator('#leagueSeasonsList .leaderboard-row').count(), 7);
      assert.match(await page.locator('#leagueSeasonsList .league-season').first().textContent(), /сентябрь 2026/);
      assert.match(await page.locator('#leagueSeasonsList .league-season').first().textContent(), /Скрыто/);
      const geometry = await page.evaluate(() => ({
        viewport: innerWidth, scroll: document.documentElement.scrollWidth,
        rows: [...document.querySelectorAll('#leagueSeasonsList .leaderboard-row')].map(e => {
          const r = e.getBoundingClientRect(); return { left: r.left, right: r.right };
        })
      }));
      assert.ok(geometry.scroll <= width, `${platform}/${width}: horizontal overflow`);
      assert.ok(geometry.rows.every(r => r.left >= 0 && r.right <= width), `${platform}/${width}: clipped rows`);
      await page.screenshot({ path: path.join(output, `${platform}-${width}.png`), fullPage: true });
      await page.locator('#leagueSeasonsBackButton').click();
      assert.equal(await page.locator('.screen.active').getAttribute('data-screen'), 'league');
      results.push({ platform, width, navigation: true, seasons: 3, leaders: 7, overflow: false });
    }
    await page.evaluate(() => { window.archiveMode = 'error'; });
    await page.locator('#openLeagueSeasons').click();
    await page.locator('#retryLeagueSeasons').waitFor({ state: 'visible' });
    assert.match(await page.locator('#leagueSeasonsList').textContent(), /Не удалось загрузить/);
    await page.evaluate(() => { window.archiveMode = 'empty'; });
    await page.locator('#retryLeagueSeasons').click();
    await page.waitForFunction(() => document.querySelector('#leagueSeasonsList').textContent.includes('первого завершённого месяца'));
    assert.equal(await page.locator('#retryLeagueSeasons').isVisible(), false);
    await page.evaluate(() => {
      window.archiveMode = 'success';
      window.archiveFixture = { seasons: [{ month: '<img src=x onerror=alert(1)>', leaders: [{ rank: 1, name: '<script>alert(1)</script>', spend: 999999999999, showAvatar: false }] }] };
    });
    await page.locator('#leagueSeasonsBackButton').click();
    await page.locator('#openLeagueSeasons').click();
    await page.waitForFunction(() => document.querySelector('#leagueSeasonsList').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#leagueSeasonsList img, #leagueSeasonsList script').count(), 0);
    assert.match(await page.locator('#leagueSeasonsList').textContent(), /<script>alert\(1\)<\/script>/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.close();
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, results, errorRetry: true, emptyState: true, escaping: true }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
