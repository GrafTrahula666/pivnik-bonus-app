import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const buildRoot = path.join(root, 'vk-hosting-build');
const outDir = path.join(root, 'artifacts', 'vk-native-hosting-browser-smoke');
const port = 4187;

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
  const response = await page.goto(`http://127.0.0.1:${port}/index.html?vk-native-smoke=1`, { waitUntil: 'networkidle' });
  assert(response?.status() === 200, `index.html returned ${response?.status()}`);

  await page.addStyleTag({ content: '.boot-screen{display:none!important}.app-shell{display:block!important}.screen{display:none!important}.screen.client-home{display:block!important}' });
  await page.evaluate(() => {
    const html = document.documentElement;
    html.classList.remove('platform-telegram', 'android-webview', 'lite-mode', 'reduce-effects');
    html.classList.add('platform-vk');
    document.querySelector('#appShell')?.classList.remove('hidden');
    document.querySelector('#bootScreen')?.classList.add('hidden');
  });

  const evidence = await page.evaluate(() => {
    const read = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        pointerEvents: style.pointerEvents,
        display: style.display,
        visibility: style.visibility
      };
    };
    return {
      title: document.title,
      htmlClasses: [...document.documentElement.classList],
      navButtons: document.querySelectorAll('.bottom-nav button').length,
      hero: read('.hero-card'),
      activeNav: read('.bottom-nav button.active'),
      qrButton: read('.bottom-nav .qr-nav-button'),
      qrIcon: read('.bottom-nav .qr-nav-button > span'),
      profileLink: read('[data-screen="profile"], [data-target="profile"]')
    };
  });

  assert(evidence.htmlClasses.includes('platform-vk'), 'VK platform class was not applied');
  assert(evidence.navButtons >= 4, `expected bottom navigation controls, got ${evidence.navButtons}`);
  assert(evidence.hero, 'home hero surface missing');
  assert(evidence.activeNav, 'active bottom navigation control missing');
  assert(evidence.qrButton, 'central QR navigation control missing');
  assert(evidence.qrIcon, 'central QR icon surface missing');
  assert(evidence.activeNav.pointerEvents !== 'none', 'active navigation blocks pointer events');
  assert(evidence.qrButton.pointerEvents !== 'none', 'QR navigation blocks pointer events');
  assert(!/telegram\.org\/js\/telegram-web-app\.js/i.test(await page.content()), 'Telegram runtime leaked into VK bundle');
  assert(pageErrors.length === 0, `page errors detected: ${pageErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `failed local requests detected: ${JSON.stringify(failedRequests)}`);

  await page.screenshot({ path: path.join(outDir, 'vk-home.png'), fullPage: true });
  await fs.writeFile(path.join(outDir, 'evidence.json'), JSON.stringify({ evidence, pageErrors, failedRequests }, null, 2));
  console.log(JSON.stringify({ ok: true, outDir: path.relative(root, outDir), evidence }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
