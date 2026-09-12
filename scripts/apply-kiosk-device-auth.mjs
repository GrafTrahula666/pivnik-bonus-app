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
await write('app.js', app);

console.log('kiosk device auth runtime patch applied');
