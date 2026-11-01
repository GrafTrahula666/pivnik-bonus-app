import { _electron as electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { start } from '../src/server.js';
import { passwordHash } from '../src/auth.js';

const output = resolve(process.env.LIVE_QA_OUTPUT_DIR || '../work/halloween-electron-qa');
await mkdir(output, { recursive: true });
const origin = 'http://localhost:4320';
const server = await start({ LIVE_MODE: 'demo', PORT: '4320', LIVE_DATA_DIR: `${output}/database`, LIVE_PUBLIC_ORIGIN: origin,
  LIVE_ACCOUNTS_JSON: JSON.stringify([{ name: 'owner', role: 'owner', passwordHash: passwordHash('electron-fixture-password') }]) });
let desktop;
const launch = () => electron.launch({ executablePath: resolve('node_modules/electron/dist/electron'),
  args: ['--no-sandbox', resolve('desktop')], env: { ...process.env, PIVNIK_DESKTOP_DEMO: '1', XDG_CONFIG_HOME: `${output}/config`, XDG_CACHE_HOME: `${output}/cache` } });
try {
  desktop = await launch();
  let control = await desktop.firstWindow();
  await control.locator('input[name=origin]').fill(origin);
  await control.locator('button').click();
  await control.locator('[name=account]').fill('owner');
  await control.locator('[name=password]').fill('electron-fixture-password');
  await control.locator('#login-form button').click();
  await control.getByText('Среди своих', { exact: true }).waitFor();
  const displays = await control.evaluate(() => window.pivnikDesktop.displays());
  if (!displays.length) throw new Error('No display enumeration');
  await control.evaluate(id => window.pivnikDesktop.showScreen(id), displays[0].id);
  let show;
  for (let attempt = 0; attempt < 20; attempt++) {
    show = desktop.windows().find(w => w.url().endsWith('/screen'));
    if (show) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!show) throw new Error('Independent show window not created');
  await show.locator('#stage').waitFor();
  if (await control.evaluate(() => typeof require !== 'undefined')) throw new Error('Node exposed to renderer');
  await control.screenshot({ path: `${output}/electron-control.png` });
  await desktop.close(); desktop = await launch();
  await desktop.firstWindow();
  for (let attempt = 0; attempt < 30; attempt++) {
    control = desktop.windows().find(w => w.url().endsWith('/control'));
    if (control) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!control) throw new Error('Control window not restored');
  await control.getByText('Среди своих', { exact: true }).waitFor();
  await desktop.waitForEvent('window', { predicate: w => w !== control, timeout: 5000 }).catch(() => {});
  const restored = desktop.windows().find(w => w.url().endsWith('/screen'));
  if (!restored) throw new Error('Show window not restored');
  await restored.locator('#stage').waitFor();
  const fullscreen = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isFullScreen()));
  if (!fullscreen) throw new Error('Show not fullscreen');
  await writeFile(`${output}/electron-result.json`, JSON.stringify({ nativePlatform: process.platform, control: true, secondWindow: true, displayEnumeration: true, fullscreen: true, rendererNodeDisabled: true, persistedSession: true, restoredWindows: true }, null, 2));
} finally { await desktop?.close(); await server.close(); }
