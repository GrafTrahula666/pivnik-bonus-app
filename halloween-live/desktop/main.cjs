const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let control, show, config = {}, backend;
const configPath = () => path.join(app.getPath('userData'), 'settings.json');
function save() { fs.writeFileSync(configPath(), JSON.stringify(config), { mode: 0o600 }); }
function validOrigin(value) {
  try {
    const u = new URL(value);
    const localDemo = process.env.PIVNIK_DESKTOP_DEMO === '1' && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
    return (u.protocol === 'https:' || localDemo) && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash ? u.origin : null;
  } catch { return null; }
}
function trusted(event) {
  return event.sender === control?.webContents && (event.senderFrame.url === `file://${path.join(__dirname, 'setup.html')}` || (backend && new URL(event.senderFrame.url).origin === backend));
}
function windowOptions(bounds) {
  return { ...bounds, backgroundColor: '#100e18', icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:pivnik-halloween-live', webSecurity: true, allowRunningInsecureContent: false } };
}
function protect(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    try { if (!backend || new URL(url).origin !== backend) event.preventDefault(); } catch { event.preventDefault(); }
  });
}
function createShow(displayId) {
  if (!backend) return;
  const displays = screen.getAllDisplays();
  const target = displays.find(d => d.id === displayId) || displays.find(d => d.id !== screen.getPrimaryDisplay().id) || displays[0];
  if (show && !show.isDestroyed()) show.destroy();
  show = new BrowserWindow({ ...windowOptions(target.bounds), title: 'PIVNIK · Экран шоу', autoHideMenuBar: true });
  protect(show); show.loadURL(`${backend}/screen`); show.setFullScreen(true);
  config.showOpen = true; config.displayId = target.id; save();
  show.on('closed', () => { show = null; if (!app.quitting) { config.showOpen = false; save(); } });
}
app.requestSingleInstanceLock() || app.quit();
app.on('second-instance', () => { control?.show(); control?.focus(); });
app.whenReady().then(() => {
  try { config = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { config = {}; }
  backend = validOrigin(config.backend);
  const partition = session.fromPartition('persist:pivnik-halloween-live');
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  control = new BrowserWindow({ ...windowOptions({ width: 1400, height: 980, minWidth: 1000, minHeight: 730 }), title: 'PIVNIK Halloween Live', autoHideMenuBar: true });
  protect(control);
  if (backend) control.loadURL(`${backend}/control`); else control.loadFile(path.join(__dirname, 'setup.html'));
  if (backend && config.showOpen) createShow(config.displayId);
  control.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) control.loadFile(path.join(__dirname, 'setup.html'));
  });
  // A local menu shortcut permits changing an unreachable server without a browser.
  control.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'b') control.loadFile(path.join(__dirname, 'setup.html'));
  });
  control.on('closed', () => app.quit());
});
ipcMain.handle('live:set-backend', async (event, value) => {
  if (!trusted(event)) throw new Error('Denied');
  const origin = validOrigin(value); if (!origin) throw new Error('Укажите HTTPS-адрес сервера без пути.');
  backend = origin; config.backend = origin; save();
  await control.loadURL(`${backend}/control`); return true;
});
ipcMain.handle('live:displays', event => {
  if (!trusted(event)) throw new Error('Denied');
  return screen.getAllDisplays().map((d, index) => ({ id: d.id, label: `${d.label || `Экран ${index + 1}`} · ${d.size.width} × ${d.size.height}${d.id === screen.getPrimaryDisplay().id ? ' · основной' : ''}` }));
});
ipcMain.handle('live:show-screen', (event, displayId) => {
  if (!trusted(event) || !Number.isInteger(displayId)) throw new Error('Denied');
  createShow(displayId); return true;
});
app.on('before-quit', () => { app.quitting = true; });
app.on('window-all-closed', () => app.quit());
