import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = path.join(root, 'artifacts', 'vk-tg-black-frosted-parity-smoke');
const port = 4188;
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

function isTransparent(value) {
  return value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
}

function rgbMax(value) {
  const match = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return match ? Math.max(Number(match[1]), Number(match[2]), Number(match[3])) : 255;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const clean = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (clean.includes('..')) throw new Error('invalid path');
    const filePath = path.join(root, clean);
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
const results = {};

async function inspectPlatform(platform) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const failedRequests = [];
  const pageErrors = [];
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }));
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname === '127.0.0.1') {
      if (requestUrl.pathname.endsWith('.js')) {
        await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '' });
        return;
      }
      await route.continue();
      return;
    }
    await route.fulfill({ status: 204, contentType: 'text/plain', body: '' });
  });

  try {
    const response = await page.goto(`http://127.0.0.1:${port}/index.html?parity=${platform}`, { waitUntil: 'networkidle' });
    assert(response?.status() === 200, `${platform}: index.html returned ${response?.status()}`);
    await page.addStyleTag({ content: '.boot-screen{display:none!important}.app-shell{display:block!important}.screen{display:none!important}.screen.client-home{display:block!important}' });
    await page.evaluate((name) => {
      const html = document.documentElement;
      html.classList.remove('platform-vk', 'platform-telegram', 'android-webview', 'lite-mode', 'reduce-effects');
      html.classList.add(`platform-${name}`);
      document.querySelector('#appShell')?.classList.remove('hidden');
      document.querySelector('#bootScreen')?.classList.add('hidden');
    }, platform);

    const evidence = await page.evaluate(() => {
      const read = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        return {
          backgroundImage: style.backgroundImage,
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          pointerEvents: style.pointerEvents,
          display: style.display,
          visibility: style.visibility
        };
      };
      return {
        htmlClasses: [...document.documentElement.classList],
        navButtons: document.querySelectorAll('.bottom-nav button').length,
        hero: read('.hero-card'),
        activeNav: read('.bottom-nav button.active'),
        activeNavIcon: read('.bottom-nav button.active:not(.qr-nav-button) > span'),
        qrButton: read('.bottom-nav .qr-nav-button'),
        qrIcon: read('.bottom-nav .qr-nav-button > span')
      };
    });

    assert(evidence.htmlClasses.includes(`platform-${platform}`), `${platform}: platform class missing`);
    assert(evidence.navButtons >= 4, `${platform}: expected bottom navigation controls, got ${evidence.navButtons}`);
    assert(evidence.hero && evidence.activeNav && evidence.activeNavIcon && evidence.qrButton && evidence.qrIcon, `${platform}: required home/navigation surfaces missing`);
    assert(evidence.activeNav.pointerEvents !== 'none', `${platform}: active navigation blocks pointer events`);
    assert(evidence.qrButton.pointerEvents !== 'none', `${platform}: QR navigation blocks pointer events`);
    assert(isTransparent(evidence.activeNav.backgroundColor) && evidence.activeNav.backgroundImage === 'none', `${platform}: active outer plate is not transparent: ${JSON.stringify(evidence.activeNav)}`);
    assert(isTransparent(evidence.qrButton.backgroundColor) && evidence.qrButton.backgroundImage === 'none', `${platform}: QR outer plate is not transparent: ${JSON.stringify(evidence.qrButton)}`);
    assert(evidence.activeNavIcon.backgroundImage !== 'none' || rgbMax(evidence.activeNavIcon.backgroundColor) < 40, `${platform}: active icon is not black-frosted`);
    assert(evidence.qrIcon.backgroundImage !== 'none' || rgbMax(evidence.qrIcon.backgroundColor) < 40, `${platform}: QR icon is not black-frosted`);
    assert(evidence.hero.backgroundImage !== 'none' || rgbMax(evidence.hero.backgroundColor) < 50, `${platform}: hero is not black-frosted`);
    assert(pageErrors.length === 0, `${platform}: page errors: ${pageErrors.join(' | ')}`);
    assert(failedRequests.length === 0, `${platform}: failed local requests: ${JSON.stringify(failedRequests)}`);

    await page.screenshot({ path: path.join(outDir, `${platform}-home.png`), fullPage: true });
    return { evidence, pageErrors, failedRequests };
  } finally {
    await context.close();
  }
}

try {
  results.vk = await inspectPlatform('vk');
  results.telegram = await inspectPlatform('telegram');
  const vk = results.vk.evidence;
  const tg = results.telegram.evidence;
  assert(vk.navButtons === tg.navButtons, `VK/TG navigation count differs: ${vk.navButtons} vs ${tg.navButtons}`);
  assert(isTransparent(vk.activeNav.backgroundColor) === isTransparent(tg.activeNav.backgroundColor), 'VK/TG active navigation transparency differs');
  assert(isTransparent(vk.qrButton.backgroundColor) === isTransparent(tg.qrButton.backgroundColor), 'VK/TG QR outer transparency differs');
  await fs.writeFile(path.join(outDir, 'evidence.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, outDir: path.relative(root, outDir), platforms: Object.keys(results) }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
