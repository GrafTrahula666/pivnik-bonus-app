import fs from 'node:fs/promises';

async function read(path) { return fs.readFile(path, 'utf8'); }
async function write(path, value) { return fs.writeFile(path, value); }

function insertAfter(source, anchor, addition, label) {
  if (source.includes(addition.trim())) return source;
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`kiosk device auth: missing ${label} anchor`);
  return source.slice(0, index + anchor.length) + addition + source.slice(index + anchor.length);
}

function insertBefore(source, anchor, addition, label) {
  if (source.includes(addition.trim())) return source;
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error(`kiosk device auth: missing ${label} anchor`);
  return source.slice(0, index) + addition + source.slice(index);
}

let server = await read('server.js');
server = insertAfter(
  server,
  "import { createBeerGiftTransactionPersistence } from './beer-gift-transaction-persistence.js';",
  "\nimport { createDeviceAuthPersistence } from './device-auth-persistence.js';\nimport { registerDeviceAuthRoutes } from './device-auth-routes.js';",
  'server import'
);
server = insertBefore(
  server,
  "if (!process.env.DATABASE_URL) {",
  `const kioskDeviceAuthEnabled = String(process.env.PIVNIK_KIOSK_DEVICE_AUTH || '').toLowerCase() === 'true';\nconst deviceAuthPepper = crypto.createHmac('sha256', sessionSecret).update('pivnik:kiosk-device-auth:v1').digest();\n\n`,
  'server configuration'
);
server = insertBefore(
  server,
  "app.post('/api/auth', async (req, res, next) => {",
  `const kioskDeviceAuthPersistence = kioskDeviceAuthEnabled\n  ? createDeviceAuthPersistence({ pool, pepper: deviceAuthPepper, termsVersion: TERMS_VERSION })\n  : null;\n\nregisterDeviceAuthRoutes({\n  app,\n  enabled: kioskDeviceAuthEnabled,\n  persistence: kioskDeviceAuthPersistence,\n  authRequired,\n  requireRole,\n  signSession,\n  getProfile,\n  loadPublicDesign: async () => {\n    const result = await pool.query('SELECT published FROM app_settings WHERE id = 1');\n    return result.rows[0]?.published || DEFAULT_DESIGN;\n  },\n  publicStatuses: () => STATUS_LEVELS.map((item) => ({\n    ...item,\n    min: Number(item.minCents || 0) / 100,\n    next: item.nextCents ? Number(item.nextCents) / 100 : null\n  }))\n});\n\n`,
  'server route registration'
);
await write('server.js', server);

let gateway = await read('universal-server.js');
if (!gateway.includes("pathname.startsWith('/api/device/')")) {
  const accountLinkTail = "    || pathname.startsWith('/api/account-link/');";
  if (!gateway.includes(accountLinkTail)) throw new Error('kiosk device auth: missing gateway consent exemption anchor');
  gateway = gateway.replace(
    accountLinkTail,
    "    || pathname.startsWith('/api/account-link/')\n    || pathname.startsWith('/api/device/');"
  );
}
await write('universal-server.js', gateway);

let app = await read('app.js');
app = insertAfter(
  app,
  'refreshTelegramBridge();',
  `\n\nfunction readKioskBootstrapCode() {\n  const candidates = [];\n  try { candidates.push(String(refreshTelegramBridge()?.initDataUnsafe?.start_param || '')); } catch (_) {}\n  try {\n    const params = new URLSearchParams(location.search);\n    candidates.push(String(params.get('tgWebAppStartParam') || ''));\n    candidates.push(String(params.get('startapp') || ''));\n    candidates.push(String(params.get('device_code') || ''));\n  } catch (_) {}\n  try { candidates.push(decodeURIComponent(String(location.hash || '').replace(/^#/, ''))); } catch (_) {}\n  return candidates.map((value) => value.trim()).find((value) => /^pvkboot_[A-Za-z0-9_-]{30,80}$/.test(value)) || '';\n}\n\nasync function authenticateKioskBootstrap(code) {\n  const data = await api('/api/device/session', {\n    method: 'POST',\n    body: JSON.stringify({ bootstrapCode: code }),\n    headers: { authorization: '' },\n    retries: 0,\n    timeoutMs: 7000\n  });\n  state.token = data.token;\n  safeStorage.set('pivnik_session', state.token);\n  applyProfilePayload(data);\n  return true;\n}`,
  'client bootstrap helper'
);

const authAnchor = `async function authenticate() {\n  const initData = await waitForTelegramInitData(isAndroid ? 6000 : 2600);`;
if (!app.includes('await authenticateKioskBootstrap(kioskBootstrapCode)')) {
  if (!app.includes(authAnchor)) throw new Error('kiosk device auth: missing authenticate anchor');
  app = app.replace(
    authAnchor,
    `async function authenticate() {\n  const kioskBootstrapCode = readKioskBootstrapCode();\n  if (kioskBootstrapCode) {\n    await authenticateKioskBootstrap(kioskBootstrapCode);\n    return;\n  }\n  const initData = await waitForTelegramInitData(isAndroid ? 6000 : 2600);`
  );
}

const kioskAdminUi = `\n\nfunction ensureKioskDeviceAdminUi() {\n  if (!roleCanWrite(state.profile?.role)) return;\n  const quick = document.querySelector(\".screen[data-screen='admin'] .admin-quick-grid\");\n  if (!quick || document.getElementById('openKioskDevices')) return;\n  const button = document.createElement('button');\n  button.type = 'button';\n  button.id = 'openKioskDevices';\n  button.innerHTML = '<span>Барные устройства</span><small>привязка телефона и отзыв доступа</small>';\n  button.addEventListener('click', () => void openKioskDevicesAdmin());\n  quick.appendChild(button);\n}\n\nfunction ensureKioskDevicesModal() {\n  let modal = document.getElementById('kioskDevicesModal');\n  if (modal) return modal;\n  modal = document.createElement('div');\n  modal.className = 'modal';\n  modal.id = 'kioskDevicesModal';\n  modal.setAttribute('aria-hidden', 'true');\n  modal.innerHTML = \\`<div class=\"modal-sheet tall-sheet\">\n    <button class=\"close\" type=\"button\" id=\"closeKioskDevices\">×</button>\n    <span class=\"muted\">Админ-панель</span><h2>Барные устройства</h2>\n    <p class=\"muted\">Создай одноразовый код и введи его на Samsung. Код живёт 10 минут и используется один раз.</p>\n    <div class=\"admin-filter-row\"><input class=\"text-input\" id=\"kioskDeviceLabel\" value=\"Пивник • Бар\" placeholder=\"Имя устройства\"><button class=\"text-btn\" id=\"createKioskPairCode\" type=\"button\">Создать код</button></div>\n    <div id=\"kioskPairCodeResult\" class=\"empty-state\">Код ещё не создан</div>\n    <div id=\"kioskDeviceList\" class=\"operation-list empty-state\">Загрузка…</div>\n  </div>\\`;\n  document.body.appendChild(modal);\n  modal.querySelector('#closeKioskDevices')?.addEventListener('click', () => closeModal('kioskDevicesModal'));\n  modal.querySelector('#createKioskPairCode')?.addEventListener('click', async () => {\n    const label = modal.querySelector('#kioskDeviceLabel')?.value?.trim() || 'Пивник • Бар';\n    const result = modal.querySelector('#kioskPairCodeResult');\n    try {\n      const data = await api('/api/admin/devices/pairing-code', { method: 'POST', body: JSON.stringify({ label }) });\n      if (result) {\n        result.className = 'operation-list';\n        result.innerHTML = \\`<div class=\"op-row\"><div><b style=\"font-size:24px;letter-spacing:2px\">\${escapeHtml(data.code)}</b><small>Действует до \${new Date(data.expiresAt).toLocaleTimeString('ru-RU')}</small></div></div>\\`;\n      }\n      toast('Код привязки создан');\n    } catch (error) { toast(error.message); }\n  });\n  return modal;\n}\n\nasync function loadKioskDevicesAdmin() {\n  const modal = ensureKioskDevicesModal();\n  const root = modal.querySelector('#kioskDeviceList');\n  try {\n    const data = await api('/api/admin/devices');\n    const devices = data.devices || [];\n    root.className = \\`operation-list\${devices.length ? '' : ' empty-state'}\\`;\n    root.innerHTML = devices.length ? devices.map((device) => {\n      const revoked = Boolean(device.revokedAt);\n      const seen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('ru-RU') : 'ещё не использовалось';\n      return \\`<div class=\"op-row \\${revoked ? 'cancelled' : ''}\"><div><b>\${escapeHtml(device.label || 'Барный терминал')}</b><small>\${revoked ? 'Доступ отозван' : 'Активно'} · последний доступ: \${escapeHtml(seen)}</small></div>\${revoked ? '' : \\`<button class=\"text-btn danger-text\" type=\"button\" data-kiosk-revoke=\"\${escapeHtml(device.id)}\">Отозвать</button>\\`}</div>\\`;\n    }).join('') : 'Привязанных устройств пока нет';\n    root.querySelectorAll('[data-kiosk-revoke]').forEach((button) => button.addEventListener('click', async () => {\n      if (!confirm('Отозвать доступ этого барного телефона? Уже выданные kiosk-сессии тоже будут отключены.')) return;\n      try {\n        await api(\\`/api/admin/devices/\${encodeURIComponent(button.dataset.kioskRevoke)}/revoke\\`, { method: 'POST', body: '{}' });\n        toast('Доступ устройства отозван');\n        await loadKioskDevicesAdmin();\n      } catch (error) { toast(error.message); }\n    }));\n  } catch (error) {\n    root.className = 'operation-list empty-state';\n    root.textContent = 'Device Auth пока не включён';\n    toast(error.message);\n  }\n}\n\nasync function openKioskDevicesAdmin() {\n  ensureKioskDevicesModal();\n  openModal('kioskDevicesModal');\n  await loadKioskDevicesAdmin();\n}`;
if (!app.includes('function ensureKioskDeviceAdminUi()')) {
  const adminAnchor = '\nasync function loadAdmin() {';
  if (!app.includes(adminAnchor)) throw new Error('kiosk device auth: missing admin UI anchor');
  app = app.replace(adminAnchor, kioskAdminUi + adminAnchor);
}

if (!app.includes('ensureKioskDeviceAdminUi();')) {
  const loadAdminTail = "  renderAdminContent(contentData);\n}";
  if (!app.includes(loadAdminTail)) throw new Error('kiosk device auth: missing loadAdmin tail anchor');
  app = app.replace(loadAdminTail, "  renderAdminContent(contentData);\n  ensureKioskDeviceAdminUi();\n}");
}

await write('app.js', app);

console.log('kiosk device auth runtime patch applied');
