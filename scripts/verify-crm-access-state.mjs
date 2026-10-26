import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH);
const app = await readFile('app.js', 'utf8');
const functions = app.slice(app.indexOf('function adminUsersDirectoryParams('), app.indexOf('async function refreshAdminUsersDirectory('));
const originalHTML = await readFile('index.html', 'utf8');
const css = await readFile('styles.css', 'utf8');
const html = originalHTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '') + `<style>${css}</style>`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true, args: ['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-dev-shm-usage','--use-gl=disabled','--disable-software-rasterizer'] });
const cases = [];
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const status of [401, 403, 503, 0]) {
      await page.setContent(html);
      await page.evaluate(({ functions, status }) => {
        window.state = { profile: { id: 'fixture' }, adminUsers: [], adminUsersRequestSeq: 0, adminUsersDirectory: { page: 1, pages: 1, total: 0, limit: 25 }, adminUsersFilterTimer: 0 };
        window.$ = selector => document.querySelector(selector);
        window.fmt = String;
        window.renderUsers = users => { document.querySelector('#allUsersList').textContent = users.length ? 'Клиент стенда' : 'Нет пользователей'; };
        window.openModal = () => {};
        window.toast = () => {};
        window.fixtureStatus = status;
        window.api = async () => { if (window.fixtureStatus) throw Object.assign(new Error('fixture failure'), { status: window.fixtureStatus }); return { users: [], pagination: { page: 1, limit: 25, total: 0, pages: 1 } }; };
        (0, eval)(functions);
        const modal = document.querySelector('#adminUsersModal');
        document.querySelector('#bootScreen')?.remove();
        modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
        // Force the existing shell modal visible; no full boot/navigation claim.
        modal.style.display = 'flex';
      }, { functions, status });
      await page.evaluate(() => loadAdminUsersDirectory(1).catch(() => {}));
      const result = await page.evaluate(() => {
        const root = document.querySelector('#allUsersList'), retry = document.querySelector('#adminUsersRetry');
        const rect = root.getBoundingClientRect();
        return { text: root.textContent, retryHidden: retry.hidden, busy: state.adminUsersDirectory.busy, left: rect.left, right: rect.right, width: rect.width };
      });
      assert.equal(result.busy, false);
      assert.ok(result.width > 0 && result.left >= 0 && result.right <= width + 1);
      assert.equal(result.retryHidden, status !== 503);
      assert.equal(await page.locator('#adminUsersRetry').isVisible(), status === 503);
      if (status === 401) assert.match(result.text, /Сессия истекла/);
      if (status === 403) assert.match(result.text, /Нет доступа/);
      if (status === 503) {
        assert.match(result.text, /Повторите попытку/);
        await page.evaluate(() => { window.fixtureStatus = 0; });
        await page.locator('#adminUsersRetry').click();
        assert.equal(await page.locator('#allUsersList').textContent(), 'Нет пользователей');
        assert.equal(await page.locator('#adminUsersRetry').evaluate(el => el.hidden), true);
      }
      cases.push({ width, status, ...result });
    }
  }
  console.log(JSON.stringify({ passed: cases.length, cases, limits: 'Original directory loader, shell and styles. Fixture API, renderUsers adapter and forced modal visibility; no full boot, signed identity, server/SQL, history or tenant proof.' }));
} finally { await browser.close(); }
