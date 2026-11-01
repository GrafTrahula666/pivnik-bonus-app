import { webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { start } from '../src/server.js';
import { passwordHash } from '../src/auth.js';

const output = resolve(process.env.LIVE_QA_OUTPUT_DIR || '../work/halloween-webkit-qa');
await mkdir(output, { recursive: true });
const origin = 'http://localhost:4319';
const server = await start({ LIVE_MODE: 'demo', PORT: '4319', LIVE_DATA_DIR: `${output}/database`,
  LIVE_PUBLIC_ORIGIN: origin, LIVE_ACCOUNTS_JSON: JSON.stringify([{ name: 'scanner', role: 'scanner', passwordHash: passwordHash('webkit-fixture-password') }]) });
let browser;
try {
  browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/scanner`);
  await page.locator('[name=account]').fill('scanner');
  await page.locator('[name=password]').fill('webkit-fixture-password');
  await page.locator('#login-form button').click();
  await page.locator('#scanner-view').waitFor();
  await page.getByText('Ввести код', { exact: true }).click();
  await page.locator('dialog input[name=payload]').fill('PVK-DEMO-0001');
  await page.locator('dialog button[type=submit]').click();
  await page.locator('dialog').waitFor({ state: 'hidden' });
  await page.locator('#scan-count').filter({ hasText: '1' }).waitFor();
  const manifest = await (await context.request.get(`${origin}/manifest.webmanifest`)).json();
  if (manifest.display !== 'standalone' || manifest.start_url !== '/scanner') throw new Error('Invalid scanner manifest');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Horizontal overflow');
  await page.screenshot({ path: `${output}/webkit-scanner.png`, fullPage: true });
  await context.setOffline(true);
  await page.getByText('Ввести код', { exact: true }).click();
  await page.locator('dialog input[name=payload]').fill('PVK-DEMO-0002');
  await page.locator('dialog button[type=submit]').click();
  await page.locator('dialog .form-error').filter({ hasText: 'Нет связи' }).waitFor();
  await context.setOffline(false);
  await writeFile(`${output}/webkit-result.json`, JSON.stringify({ errors, manualRegistration: true, noOfflineConfirmation: true, manifest: true, serviceWorker: true, noHorizontalOverflow: true }, null, 2));
  if (errors.length) throw new Error('WebKit page errors');
} finally { await browser?.close(); await server.close(); }
