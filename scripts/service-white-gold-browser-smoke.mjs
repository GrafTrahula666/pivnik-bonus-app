import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = path.join(root, 'artifacts', 'service-white-gold-browser-smoke');
const port = 4191;
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.svg', 'image/svg+xml']
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function channels(value) {
  const match = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isLight(value) {
  const rgb = channels(value);
  return rgb ? Math.min(...rgb) >= 180 : false;
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

async function inspect(platform, target) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('requestfailed', (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || 'failed'
  }));

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
    const response = await page.goto(`http://127.0.0.1:${port}/index.html?service-smoke=${platform}-${target}`, { waitUntil: 'networkidle' });
    assert(response?.status() === 200, `${platform}/${target}: index returned ${response?.status()}`);

    await page.evaluate(({ platformName, screenName }) => {
      document.documentElement.classList.remove('platform-vk', 'platform-telegram');
      document.documentElement.classList.add(`platform-${platformName}`);
      document.querySelector('#bootScreen')?.classList.add('hidden');

      const shell = document.querySelector('#appShell');
      shell?.classList.remove('hidden');
      shell?.classList.add('service-mode');

      document.querySelectorAll('.screen').forEach((screen) => {
        screen.classList.toggle('active', screen.dataset.screen === screenName);
      });

      if (screenName === 'admin') {
        const users = document.querySelector('#usersList');
        if (users) {
          users.className = 'operation-list';
          users.innerHTML = '<div class="user-row"><div><b>Тестовый пользователь</b><small>Telegram · @test</small></div><strong>125 Б</strong><div class="user-actions"><select><option>Клиент</option></select><button class="text-btn danger-text" type="button">Удалить</button></div></div>';
        }
        const ops = document.querySelector('#adminOperations');
        if (ops) {
          ops.className = 'operation-list';
          ops.innerHTML = '<div class="op-row suspicious"><span class="op-icon">!</span><div><b>Операция</b><small>Тестовая запись</small></div><strong>500 ₽</strong></div>';
        }
        const inquiries = document.querySelector('#adminInquiries');
        if (inquiries) {
          inquiries.className = 'inquiry-list';
          inquiries.innerHTML = '<article class="inquiry-row status-new"><div class="inquiry-main"><span>Новое</span><b>Вопрос</b><small>Клиент</small><p>Тестовое обращение</p></div><div class="inquiry-actions"><select><option>Новое</option></select></div></article>';
        }
        const content = document.querySelector('#adminPromotionsList');
        if (content) {
          content.className = 'admin-content-list';
          content.innerHTML = '<div class="admin-content-row"><div></div><div><b>Акция</b><small>Показывается</small></div><div class="admin-content-buttons"><button class="text-btn" type="button">Изменить</button></div></div>';
        }
        const shift = document.querySelector('#shiftStaffOptions');
        if (shift) {
          shift.className = 'shift-staff-options';
          shift.innerHTML = '<label class="shift-staff-option"><input type="checkbox"><span class="avatar">А</span><span><b>Анна</b><small>сотрудник</small></span></label>';
        }
      } else {
        const staffShop = document.querySelector('#staffShopItems');
        if (staffShop) {
          staffShop.className = 'staff-shop-items';
          staffShop.innerHTML = '<label class="staff-shop-item"><input type="radio"><span><b>Товар</b><small>100 Б</small></span></label>';
        }
      }
    }, { platformName: platform, screenName: target });

    const selectors = target === 'admin'
      ? ['.admin-head', '.admin-quick-grid > button', '.metric', '.user-row', '.op-row', '.inquiry-row', '.admin-content-row', '.shift-staff-option']
      : ['.staff-banner', '.staff-step', '.scan-zone', '.mode', '.staff-shop-item', '#createSale'];

    const evidence = await page.evaluate(({ screenName, selectorsToRead }) => {
      const styleOf = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          selector,
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          color: style.color,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      };
      const screen = document.querySelector(`.screen[data-screen="${screenName}"]`);
      const shell = document.querySelector('#appShell');
      const screenStyle = screen ? getComputedStyle(screen) : null;
      const shellStyle = shell ? getComputedStyle(shell) : null;
      return {
        htmlClasses: [...document.documentElement.classList],
        shell: shell ? {
          backgroundColor: shellStyle.backgroundColor,
          backgroundImage: shellStyle.backgroundImage,
          color: shellStyle.color,
          width: shell.getBoundingClientRect().width
        } : null,
        screen: screen ? {
          display: screenStyle.display,
          visibility: screenStyle.visibility,
          pointerEvents: screenStyle.pointerEvents,
          width: screen.getBoundingClientRect().width,
          scrollHeight: screen.scrollHeight,
          clientHeight: screen.clientHeight,
          paddingBottom: screenStyle.paddingBottom
        } : null,
        nodes: Object.fromEntries(selectorsToRead.map((selector) => [selector, styleOf(selector)])),
        roleBadgeColor: getComputedStyle(document.querySelector('#adminRoleBadge') || document.body).color
      };
    }, { screenName: target, selectorsToRead: selectors });

    assert(evidence.htmlClasses.includes(`platform-${platform}`), `${platform}/${target}: platform class missing`);
    assert(evidence.shell && evidence.screen, `${platform}/${target}: service shell missing`);
    assert(evidence.screen.display !== 'none' && evidence.screen.visibility !== 'hidden', `${platform}/${target}: service screen hidden`);
    assert(evidence.screen.pointerEvents !== 'none', `${platform}/${target}: service screen blocks pointer events`);
    assert(evidence.screen.width >= 350, `${platform}/${target}: service screen too narrow: ${evidence.screen.width}`);
    assert(evidence.shell.width >= 380, `${platform}/${target}: shell unexpectedly shrunk: ${evidence.shell.width}`);
    assert(evidence.shell.backgroundImage !== 'none' || isLight(evidence.shell.backgroundColor), `${platform}/${target}: shell is not white-gold: ${JSON.stringify(evidence.shell)}`);

    for (const [selector, node] of Object.entries(evidence.nodes)) {
      assert(node, `${platform}/${target}: missing ${selector}`);
      assert(node.display !== 'none' && node.visibility !== 'hidden', `${platform}/${target}: ${selector} hidden`);
      assert(node.pointerEvents !== 'none', `${platform}/${target}: ${selector} blocks pointer events`);
      if (selector.includes('row') || selector.includes('staff-option') || selector.includes('staff-shop-item') || selector === '.metric' || selector === '.staff-step') {
        assert(node.backgroundImage !== 'none' || isLight(node.backgroundColor), `${platform}/${target}: ${selector} kept a dark legacy surface: ${JSON.stringify(node)}`);
      }
    }

    const clickable = target === 'admin' ? '#backToProfileFromAdmin' : '#backToProfileFromStaff';
    await page.locator(clickable).click({ trial: true });
    const action = target === 'admin' ? '#saveShift' : '#createSale';
    await page.locator(action).click({ trial: true });

    assert(pageErrors.length === 0, `${platform}/${target}: page errors: ${pageErrors.join(' | ')}`);
    assert(failedRequests.length === 0, `${platform}/${target}: failed local requests: ${JSON.stringify(failedRequests)}`);

    await page.screenshot({ path: path.join(outDir, `${platform}-${target}.png`), fullPage: true });
    return { evidence, pageErrors, failedRequests };
  } finally {
    await context.close();
  }
}

try {
  for (const platform of ['vk', 'telegram']) {
    results[`${platform}-admin`] = await inspect(platform, 'admin');
    results[`${platform}-staff`] = await inspect(platform, 'staff');
  }
  await fs.writeFile(path.join(outDir, 'evidence.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, cases: Object.keys(results), outDir: path.relative(root, outDir) }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
