import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = path.join(root, 'artifacts', 'global-white-gold-browser-smoke');
const port = 4193;
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml']
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rgb(value) {
  const match = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isLight(value) {
  const c = rgb(value);
  return c ? (c[0] + c[1] + c[2]) / 3 >= 180 : false;
}

function isDarkText(value) {
  const c = rgb(value);
  return c ? (c[0] + c[1] + c[2]) / 3 <= 130 : false;
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

async function openPage({ platform, android = false, viewport = { width: 390, height: 844 } }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  const failedLocal = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).hostname === '127.0.0.1') {
      failedLocal.push({ url: request.url(), error: request.failure()?.errorText || 'failed' });
    }
  });

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname === '127.0.0.1') {
      if (requestUrl.pathname.endsWith('.js')) {
        if (requestUrl.pathname === '/red-cosmos-v2.js') {
          await route.continue();
        } else {
          await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '' });
        }
        return;
      }
      await route.continue();
      return;
    }
    await route.fulfill({ status: 204, contentType: 'text/plain', body: '' });
  });

  const response = await page.goto(
    `http://127.0.0.1:${port}/index.html?global-smoke=${platform}${android ? '-android' : ''}`,
    { waitUntil: 'networkidle' }
  );
  assert(response?.status() === 200, `${platform}: index returned ${response?.status()}`);

  const boot = await page.evaluate(() => {
    const bootScreen = document.querySelector('#bootScreen');
    const scene = document.querySelector('.boot-scene');
    const image = document.querySelector('.boot-image');
    const text = document.querySelector('#bootText');
    const style = bootScreen ? getComputedStyle(bootScreen) : null;
    const sceneRect = scene?.getBoundingClientRect();
    const imageRect = image?.getBoundingClientRect();
    return {
      display: style?.display || null,
      visibility: style?.visibility || null,
      scene: sceneRect ? { width: sceneRect.width, height: sceneRect.height } : null,
      image: imageRect ? { width: imageRect.width, height: imageRect.height } : null,
      text: text?.textContent?.trim() || ''
    };
  });
  assert(boot.display !== 'none' && boot.visibility !== 'hidden', `${platform}: loader is hidden before boot completes`);
  assert(boot.scene?.width > 250 && boot.scene?.height > 400, `${platform}: loader scene collapsed: ${JSON.stringify(boot)}`);
  assert(boot.image?.width > 250 && boot.image?.height > 400, `${platform}: loader image collapsed: ${JSON.stringify(boot)}`);
  assert(boot.text.length > 0, `${platform}: loader status text missing`);

  await page.evaluate(({ platformName, androidWebView }) => {
    const html = document.documentElement;
    html.classList.remove('platform-vk', 'platform-telegram', 'android-webview', 'lite-mode', 'reduce-effects');
    html.classList.add(`platform-${platformName}`);
    if (androidWebView) html.classList.add('android-webview');

    document.querySelector('#bootScreen')?.classList.add('hidden');
    document.querySelector('#appShell')?.classList.remove('hidden', 'service-mode', 'wheel-mode');
  }, { platformName: platform, androidWebView: android });

  return { context, page, pageErrors, failedLocal, boot };
}

async function inspectBackControls(caseName, config) {
  const { context, page, pageErrors, failedLocal } = await openPage(config);
  try {
    await page.waitForFunction(() => document.querySelectorAll('.pivnik-back-button').length > 0);

    const evidence = await page.evaluate(({ viewportWidth }) => {
      const expectedSize = viewportWidth <= 360 ? 38 : 40;
      const shell = document.querySelector('#appShell');

      const activateScreen = (target) => {
        document.querySelectorAll('.screen').forEach((screen) => {
          screen.classList.toggle('active', screen.dataset.screen === target);
        });
        shell?.classList.toggle('service-mode', target === 'staff' || target === 'admin');
        shell?.classList.toggle('wheel-mode', target === 'wheel');
      };

      const rectOf = (node) => {
        const rect = node?.getBoundingClientRect();
        return rect ? {
          x: rect.x, y: rect.y, left: rect.left, right: rect.right,
          top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height
        } : null;
      };

      const overlaps = (a, b) => Boolean(a && b
        && a.left < b.right && a.right > b.left
        && a.top < b.bottom && a.bottom > b.top);

      const readButton = (button, anchor = null) => {
        if (!button) return null;
        const style = getComputedStyle(button);
        const rect = rectOf(button);
        const anchorRect = rectOf(anchor);
        return {
          id: button.id || null,
          classes: [...button.classList],
          text: button.textContent?.trim() || '',
          ariaLabel: button.getAttribute('aria-label'),
          position: style.position,
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          rect,
          anchorRect,
          overlapsAnchor: overlaps(rect, anchorRect)
        };
      };

      const screenDefinitions = [
        ['wheelBackButton', 'wheel', '.wheel-page-head h2'],
        ['spaceverseBusinessBack', 'spaceverse-business', '.spaceverse-business-page-head > span:nth-child(2)'],
        ['backToProfileFromStaff', 'staff', '.staff-banner h2'],
        ['backToProfileFromAdmin', 'admin', '.admin-head h2']
      ];

      const screens = screenDefinitions.map(([id, screenName, anchorSelector]) => {
        activateScreen(screenName);
        return {
          screenName,
          control: readButton(document.getElementById(id), document.querySelector(anchorSelector))
        };
      });

      activateScreen('profile');
      const modals = [...document.querySelectorAll('.modal')].map((modal) => {
        const close = modal.querySelector(':scope > .modal-sheet > .close');
        if (!close) return null;
        document.querySelectorAll('.modal.open').forEach((other) => {
          if (other !== modal) {
            other.classList.remove('open');
            other.setAttribute('aria-hidden', 'true');
          }
        });
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        const siblings = [...(close.parentElement?.children || [])].filter((node) => node !== close);
        const anchor = siblings.find((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        }) || null;
        const result = {
          modalId: modal.id || null,
          control: readButton(close, anchor)
        };
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        return result;
      }).filter(Boolean);

      return { expectedSize, screens, modals };
    }, { viewportWidth: config.viewport.width });

    const all = [
      ...evidence.screens.map((item) => ({ name: item.screenName, ...item.control })),
      ...evidence.modals.map((item) => ({ name: item.modalId, ...item.control }))
    ];

    assert(all.length >= 8, `${caseName}: too few back controls inspected: ${all.length}`);
    for (const control of all) {
      assert(control, `${caseName}: missing back control`);
      assert(control.classes.includes('pivnik-back-button'), `${caseName}/${control.name}: canonical back class missing`);
      assert(control.text === '←', `${caseName}/${control.name}: inconsistent back glyph "${control.text}"`);
      assert(control.ariaLabel === 'Назад', `${caseName}/${control.name}: accessible label missing`);
      assert(control.position === 'static', `${caseName}/${control.name}: back control escaped normal flow: ${control.position}`);
      assert(control.display !== 'none' && control.visibility !== 'hidden', `${caseName}/${control.name}: back control hidden`);
      assert(control.pointerEvents !== 'none', `${caseName}/${control.name}: back control not clickable`);
      assert(Math.abs(control.rect.width - evidence.expectedSize) < 0.5,
        `${caseName}/${control.name}: width ${control.rect.width} != ${evidence.expectedSize}`);
      assert(Math.abs(control.rect.height - evidence.expectedSize) < 0.5,
        `${caseName}/${control.name}: height ${control.rect.height} != ${evidence.expectedSize}`);
      assert(!control.overlapsAnchor, `${caseName}/${control.name}: back control overlaps nearby content`);
    }

    assert(pageErrors.length === 0, `${caseName}/back-controls: page errors: ${pageErrors.join(' | ')}`);
    assert(failedLocal.length === 0, `${caseName}/back-controls: failed local requests: ${JSON.stringify(failedLocal)}`);
    return evidence;
  } finally {
    await context.close();
  }
}

async function inspectScreen(caseName, config, screenName) {
  const { context, page, pageErrors, failedLocal, boot } = await openPage(config);
  try {
    await page.evaluate((target) => {
      document.querySelectorAll('.screen').forEach((screen) => {
        screen.classList.toggle('active', screen.dataset.screen === target);
      });
      const shell = document.querySelector('#appShell');
      shell?.classList.toggle('wheel-mode', target === 'wheel');

      if (target === 'league') {
        const list = document.querySelector('#leaderboardList');
        if (list) {
          list.className = 'leaderboard-list';
          list.innerHTML = '<div class="leaderboard-row"><span>4</span><span class="leader-avatar">К</span><div><b>Клиент</b><small>@client</small></div><strong>12 500 ₽</strong></div>';
        }
      }
    }, screenName);

    const selectors = screenName === 'wheel'
      ? ['.wheel-page-head h2', '.wheel-rim', '.wheel-spin-button', '.wheel-control-card p', '.wheel-rules-link']
      : ['.client-page-title h2', '.league-summary', '.league-summary > strong', '.leaderboard-row'];

    const evidence = await page.evaluate(({ target, selectorsToRead }) => {
      const readStyle = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          color: style.color,
          borderColor: style.borderColor,
          rect: { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom }
        };
      };
      const screen = document.querySelector(`.screen[data-screen="${target}"]`);
      const screenRect = screen?.getBoundingClientRect();
      return {
        screen: screen ? {
          display: getComputedStyle(screen).display,
          visibility: getComputedStyle(screen).visibility,
          pointerEvents: getComputedStyle(screen).pointerEvents,
          width: screenRect.width,
          scrollHeight: screen.scrollHeight,
          clientHeight: screen.clientHeight
        } : null,
        nodes: Object.fromEntries(selectorsToRead.map((selector) => [selector, readStyle(selector)]))
      };
    }, { target: screenName, selectorsToRead: selectors });

    assert(evidence.screen, `${caseName}/${screenName}: screen missing`);
    assert(evidence.screen.display !== 'none' && evidence.screen.visibility !== 'hidden', `${caseName}/${screenName}: screen hidden`);
    assert(evidence.screen.pointerEvents !== 'none', `${caseName}/${screenName}: pointer events disabled`);
    assert(evidence.screen.width >= config.viewport.width - 40, `${caseName}/${screenName}: screen unexpectedly narrow: ${evidence.screen.width}`);

    for (const [selector, node] of Object.entries(evidence.nodes)) {
      assert(node, `${caseName}/${screenName}: missing ${selector}`);
      assert(node.display !== 'none' && node.visibility !== 'hidden', `${caseName}/${screenName}: ${selector} hidden`);
      assert(node.pointerEvents !== 'none', `${caseName}/${screenName}: ${selector} blocks pointer events`);
    }

    if (screenName === 'wheel') {
      assert(isDarkText(evidence.nodes['.wheel-page-head h2'].color), `${caseName}: wheel title has weak contrast`);
      assert(evidence.nodes['.wheel-rim'].backgroundImage !== 'none' || isLight(evidence.nodes['.wheel-rim'].backgroundColor),
        `${caseName}: wheel rim retained a dark legacy surface`);
      assert(evidence.nodes['.wheel-spin-button'].backgroundImage !== 'none' || isLight(evidence.nodes['.wheel-spin-button'].backgroundColor),
        `${caseName}: wheel button retained a dark legacy surface`);
      assert(isDarkText(evidence.nodes['.wheel-spin-button'].color), `${caseName}: wheel button text has weak contrast`);
      await page.locator('#wheelBackButton').click({ trial: true });
      await page.locator('#wheelSpinButton').click({ trial: true });
    } else {
      assert(isLight(evidence.nodes['.league-summary'].backgroundColor), `${caseName}: league summary is not light`);
      assert(isDarkText(evidence.nodes['.league-summary > strong'].color), `${caseName}: league summary value has weak contrast`);
      assert(isLight(evidence.nodes['.leaderboard-row'].backgroundColor), `${caseName}: league row is not light`);
      await page.locator('.bottom-nav [data-target="client"]').click({ trial: true });
    }

    assert(pageErrors.length === 0, `${caseName}/${screenName}: page errors: ${pageErrors.join(' | ')}`);
    assert(failedLocal.length === 0, `${caseName}/${screenName}: failed local requests: ${JSON.stringify(failedLocal)}`);

    await page.screenshot({ path: path.join(outDir, `${caseName}-${screenName}.png`), fullPage: true });
    return { boot, evidence };
  } finally {
    await context.close();
  }
}

async function inspectModal(caseName, config, modalId, setup) {
  const { context, page, pageErrors, failedLocal } = await openPage(config);
  try {
    await page.evaluate(({ id, setupName }) => {
      document.querySelectorAll('.screen').forEach((screen) => {
        screen.classList.toggle('active', screen.dataset.screen === 'profile');
      });

      if (setupName === 'status') {
        const list = document.querySelector('#statusLevelsList');
        if (list) {
          list.innerHTML = '<div class="status-level current"><span class="status-rank">5</span><div class="status-level-copy"><div class="status-level-head"><b>Свой</b><span>текущий</span></div><small>5% бонусов</small><p>Тестовый уровень</p></div><strong class="status-level-mark">✓</strong></div>';
        }
      }

      const modal = document.querySelector(`#${id}`);
      modal?.classList.add('open');
      modal?.setAttribute('aria-hidden', 'false');
    }, { id: modalId, setupName: setup });

    const selectors = modalId === 'qrModal'
      ? ['#qrModal .modal-sheet', '#qrModal .token', '#qrModal .close']
      : modalId === 'statusesModal'
        ? ['#statusesModal .modal-sheet', '#statusesModal .status-level', '#statusesModal .status-rank', '#statusesModal .close']
        : ['#helpModal .modal-sheet', '#helpModal .help-section', '#helpModal .help-text p', '#helpModal .close'];

    const evidence = await page.evaluate(({ id, selectorsToRead }) => {
      const readStyle = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          color: style.color,
          zIndex: style.zIndex,
          rect: { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom }
        };
      };
      const modal = document.querySelector(`#${id}`);
      const style = modal ? getComputedStyle(modal) : null;
      return {
        modal: modal ? {
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          zIndex: style.zIndex
        } : null,
        nodes: Object.fromEntries(selectorsToRead.map((selector) => [selector, readStyle(selector)]))
      };
    }, { id: modalId, selectorsToRead: selectors });

    assert(evidence.modal, `${caseName}/${modalId}: modal missing`);
    assert(evidence.modal.display !== 'none' && evidence.modal.visibility !== 'hidden', `${caseName}/${modalId}: modal hidden`);
    assert(evidence.modal.pointerEvents !== 'none', `${caseName}/${modalId}: modal blocks pointer events`);

    for (const [selector, node] of Object.entries(evidence.nodes)) {
      assert(node, `${caseName}/${modalId}: missing ${selector}`);
      assert(node.display !== 'none' && node.visibility !== 'hidden', `${caseName}/${modalId}: ${selector} hidden`);
      assert(node.pointerEvents !== 'none', `${caseName}/${modalId}: ${selector} blocks pointer events`);
    }

    const sheetSelector = `#${modalId} .modal-sheet`;
    assert(isLight(evidence.nodes[sheetSelector].backgroundColor), `${caseName}/${modalId}: modal sheet is not light`);

    if (modalId === 'qrModal') {
      assert(isDarkText(evidence.nodes['#qrModal .token'].color), `${caseName}: QR token has weak contrast`);
    }
    if (modalId === 'statusesModal') {
      assert(
        evidence.nodes['#statusesModal .status-level'].backgroundImage !== 'none'
          || isLight(evidence.nodes['#statusesModal .status-level'].backgroundColor),
        `${caseName}: status card retained dark legacy surface`
      );
      assert(
        evidence.nodes['#statusesModal .status-rank'].backgroundImage !== 'none'
          || isLight(evidence.nodes['#statusesModal .status-rank'].backgroundColor),
        `${caseName}: status rank retained dark legacy surface`
      );
    }
    if (modalId === 'helpModal') {
      assert(isLight(evidence.nodes['#helpModal .help-section'].backgroundColor), `${caseName}: help card retained dark legacy surface`);
      assert(isDarkText(evidence.nodes['#helpModal .help-text p'].color), `${caseName}: help copy has weak contrast`);
    }

    await page.locator(`#${modalId} .close`).click({ trial: true });
    assert(pageErrors.length === 0, `${caseName}/${modalId}: page errors: ${pageErrors.join(' | ')}`);
    assert(failedLocal.length === 0, `${caseName}/${modalId}: failed local requests: ${JSON.stringify(failedLocal)}`);

    await page.screenshot({ path: path.join(outDir, `${caseName}-${modalId}.png`), fullPage: true });
    return evidence;
  } finally {
    await context.close();
  }
}

try {
  const cases = [
    { name: 'vk-ios', platform: 'vk', android: false, viewport: { width: 390, height: 844 } },
    { name: 'telegram-ios', platform: 'telegram', android: false, viewport: { width: 390, height: 844 } },
    { name: 'telegram-android', platform: 'telegram', android: true, viewport: { width: 360, height: 800 } }
  ];

  for (const config of cases) {
    results[`${config.name}-back-controls`] = await inspectBackControls(config.name, config);
    results[`${config.name}-league`] = await inspectScreen(config.name, config, 'league');
    results[`${config.name}-wheel`] = await inspectScreen(config.name, config, 'wheel');
    results[`${config.name}-qr`] = await inspectModal(config.name, config, 'qrModal', 'qr');
    results[`${config.name}-statuses`] = await inspectModal(config.name, config, 'statusesModal', 'status');
    results[`${config.name}-help`] = await inspectModal(config.name, config, 'helpModal', 'help');
  }

  await fs.writeFile(path.join(outDir, 'evidence.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, cases: Object.keys(results), outDir: path.relative(root, outDir) }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
