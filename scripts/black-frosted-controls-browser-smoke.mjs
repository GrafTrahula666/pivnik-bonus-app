import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = path.join(root, 'artifacts', 'black-frosted-controls-smoke');
const port = 4174;

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2']
]);

function assert(condition, message) { if (!condition) throw new Error(message); }

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

    await page.goto(`http://127.0.0.1:${port}/index.html?controls-smoke=${mode}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '.boot-screen{display:none!important}.app-shell{display:block!important}.screen{display:none!important}.screen.client-home{display:block!important}' });
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
          boxShadow: style.boxShadow,
          backdropFilter: style.backdropFilter || style.webkitBackdropFilter || '',
          pointerEvents: style.pointerEvents
        };
      };
      const appShell = document.querySelector('.app-shell');
      return {
        hero: read('.hero-card'),
        activeButton: read('.bottom-nav button.active'),
        qrButton: read('.bottom-nav .qr-nav-button'),
        qrSpan: read('.bottom-nav .qr-nav-button > span'),
        homeSpan: read('.bottom-nav button:not(.qr-nav-button) > span'),
        appShellBeforeBackground: appShell ? getComputedStyle(appShell, '::before').backgroundImage : ''
      };
    });

    for (const key of ['hero', 'activeButton', 'qrButton', 'qrSpan', 'homeSpan']) {
      assert(metrics[key], `${mode}: required selector missing: ${key}`);
    }
    for (const key of ['activeButton', 'qrButton', 'qrSpan', 'homeSpan']) {
      assert(metrics[key].pointerEvents !== 'none', `${mode}: ${key} blocks interaction`);
    }

    for (const key of ['activeButton', 'qrButton']) {
      assert(metrics[key].backgroundImage === 'none', `${mode}: ${key} still has a background image`);
      assert(metrics[key].backgroundColor === 'rgba(0, 0, 0, 0)', `${mode}: ${key} still has a colored outer plate`);
      assert(metrics[key].boxShadow === 'none', `${mode}: ${key} still has an outer shadow plate`);
    }

    assert(/9, 11, 15/.test(metrics.hero.backgroundImage), `${mode}: black frosted surface lost`);
    assert(/blur\(/.test(metrics.qrSpan.backdropFilter), `${mode}: QR icon lost glass blur`);
    assert(!/(196, 30, 58|111, 31, 43|47, 8, 31)/.test(metrics.qrSpan.backgroundImage), `${mode}: red/burgundy QR icon tint still wins`);

    if (mode === 'vk') {
      assert(/8, 9, 12/.test(metrics.qrSpan.backgroundImage), 'vk: QR icon is not matte black');
    } else {
      assert(/12, 14, 18|10, 12, 16/.test(metrics.qrSpan.backgroundImage), 'telegram: QR icon is not black frosted glass');
      assert(/luxury-vip-space\.webp/.test(metrics.appShellBeforeBackground), 'telegram: deep-space background lost');
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
