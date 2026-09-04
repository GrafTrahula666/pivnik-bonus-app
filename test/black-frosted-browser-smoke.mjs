import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = path.join(root, 'artifacts', 'black-frosted-browser-smoke');
const port = 4173;

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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const clean = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (clean.includes('..')) throw new Error('invalid path');
    const filePath = path.join(root, clean);
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream' });
    res.end(data);
  } catch (_) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true });
const report = {};

try {
  for (const mode of ['telegram', 'vk']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();

    await page.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.hostname === 'telegram.org' || requestUrl.pathname.endsWith('.js')) {
        await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
        return;
      }
      await route.continue();
    });

    await page.goto(`http://127.0.0.1:${port}/index.html?visual-smoke=${mode}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: `
      .boot-screen { display:none!important; }
      .app-shell { display:block!important; }
      .screen { display:none!important; }
      .screen.client-home { display:block!important; }
    ` });
    await page.evaluate((platform) => {
      const html = document.documentElement;
      html.classList.remove('platform-vk', 'platform-telegram', 'android-webview', 'lite-mode', 'reduce-effects');
      html.classList.add(platform === 'vk' ? 'platform-vk' : 'platform-telegram');
      document.querySelector('#appShell')?.classList.remove('hidden');
      document.querySelector('#bootScreen')?.classList.add('hidden');
    }, mode);

    const metrics = await page.evaluate(() => {
      const read = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        return {
          backgroundImage: style.backgroundImage,
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          backdropFilter: style.backdropFilter || style.webkitBackdropFilter || '',
          pointerEvents: style.pointerEvents
        };
      };
      const appShell = document.querySelector('.app-shell');
      const before = appShell ? getComputedStyle(appShell, '::before') : null;
      return {
        hero: read('.hero-card'),
        icon: read('.icon-btn'),
        wheelMark: read('.wheel-entry-mark'),
        bottomNav: read('.bottom-nav'),
        vipGlass: read('.vip-glass-card'),
        appShellBeforeBackground: before?.backgroundImage || ''
      };
    });

    for (const key of ['hero', 'icon', 'wheelMark', 'bottomNav', 'vipGlass']) {
      assert(metrics[key], `${mode}: required selector missing: ${key}`);
      assert(metrics[key].pointerEvents !== 'none', `${mode}: ${key} blocks interaction via pointer-events:none`);
    }
    assert(/blur\(/.test(metrics.hero.backdropFilter), `${mode}: hero card has no frosted blur`);
    assert(/blur\(/.test(metrics.icon.backdropFilter), `${mode}: icon button has no frosted blur`);
    assert(/blur\(/.test(metrics.bottomNav.backdropFilter), `${mode}: bottom navigation has no frosted blur`);
    assert(/9, 11, 15/.test(metrics.hero.backgroundImage), `${mode}: hero did not resolve to black frosted surface`);
    assert(/10, 12, 16/.test(metrics.icon.backgroundImage), `${mode}: icon did not resolve to black frosted glass`);
    assert(!/47, 8, 31/.test(metrics.hero.backgroundImage), `${mode}: old burgundy/pink card surface still wins cascade`);
    if (mode === 'telegram') {
      assert(/luxury-vip-space\.webp/.test(metrics.appShellBeforeBackground), 'telegram: deep-space background is not the winning app-shell layer');
    }

    report[mode] = metrics;
    await page.screenshot({ path: path.join(outDir, `${mode}-home.png`), fullPage: true });
    await context.close();
  }

  await fs.writeFile(path.join(outDir, 'computed-styles.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, modes: Object.keys(report), outDir: path.relative(root, outDir) }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
