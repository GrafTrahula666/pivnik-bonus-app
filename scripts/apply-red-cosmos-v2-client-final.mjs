import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'app.js');
const shopFragmentPath = path.join(root, 'scripts', 'fragments', 'red-cosmos-shop-client.fragment.txt');
let source = await fs.readFile(appPath, 'utf8');
const MARKER = '// RED_COSMOS_V2_FINAL_CLIENT_RUNTIME';
const LEGACY_GLOBAL_CONSENT_BLOCKER = "document.addEventListener('click', blockUnacceptedAction, true);";
const LEGACY_GLOBAL_CONSENT_BLOCKER_LINE = /^document\.addEventListener\('click', blockUnacceptedAction, true\);$/m;
const SAFE_CONSENT_GATE_MARKER = `// RED_COSMOS_NO_GLOBAL_CLICK_BLOCKER: ${LEGACY_GLOBAL_CONSENT_BLOCKER}`;

function replaceOptional(from, to) {
  if (source.includes(from)) source = source.replace(from, to);
}

function replaceRequired(from, to, label) {
  if (source.includes(from)) {
    source = source.replace(from, to);
    return;
  }
  if (!source.includes(to)) throw new Error(`RED COSMOS v2 client: missing ${label}`);
}

if (!source.includes(MARKER)) {
  source = source.replace(/const APP_VERSION = '[^']+';/, "const APP_VERSION = '2.0-red-cosmos';");
  replaceOptional("  selectedShopItem: 'craft-05',", "  selectedShopItem: 'frame-beer-mugs',");

  replaceOptional("function renderWheelStatus() {\n  if (IS_VK) return;", "function renderWheelStatus() {");
  replaceOptional("function startWheelCountdown() {\n  if (IS_VK || state.wheel.countdownTimer) return;", "function startWheelCountdown() {\n  if (state.wheel.countdownTimer) return;");
  replaceOptional("async function loadWheelStatus() {\n  if (IS_VK || !state.token || !state.profile?.termsAccepted) return null;", "async function loadWheelStatus() {\n  if (!state.token || !state.profile?.termsAccepted) return null;");
  replaceOptional("async function spinWheel() {\n  if (IS_VK || state.wheel.busy) return;", "async function spinWheel() {\n  if (state.wheel.busy) return;");
  replaceOptional("function openWheel() {\n  if (IS_VK) return;", "function openWheel() {");
  replaceOptional("  if (!IS_VK) void loadWheelStatus().catch((error) => console.warn('Wheel status refresh skipped:', error));", "  void loadWheelStatus().catch((error) => console.warn('Wheel status refresh skipped:', error));");
  replaceOptional("  if (!IS_VK) jobs.push(loadWheelStatus());", "  jobs.push(loadWheelStatus());");

  if (!source.includes("profileFrame === 'premium-smiling-fuck'")) {
    const frameAnchor = "  if (entity.profileFrame === 'middle-finger') return 'avatar-frame avatar-frame-middle-finger';";
    if (source.includes(frameAnchor)) {
      source = source.replace(frameAnchor, `${frameAnchor}\n  if (entity.profileFrame === 'premium-smiling-fuck') return 'avatar-frame avatar-frame-premium-smiling-fuck';`);
    } else {
      const legacyAnchor = "  if (entity.profileFrame === 'vladislav') return 'avatar-frame avatar-frame-vladislav';";
      if (!source.includes(legacyAnchor)) throw new Error('RED COSMOS v2 client: missing avatar frame anchor');
      source = source.replace(legacyAnchor, `${legacyAnchor}\n  if (entity.profileFrame === 'beer-mugs') return 'avatar-frame avatar-frame-beer-mugs';\n  if (entity.profileFrame === 'beer-bottles') return 'avatar-frame avatar-frame-beer-bottles';\n  if (entity.profileFrame === 'lights') return 'avatar-frame avatar-frame-lights';\n  if (entity.profileFrame === 'premium-smiling-fuck') return 'avatar-frame avatar-frame-premium-smiling-fuck';`);
    }
  }

  if (!source.includes("'premium-smiling-fuck': '🖕'")) {
    const mapAnchor = "    'middle-finger': '🖕'";
    if (source.includes(mapAnchor)) source = source.replace(mapAnchor, `${mapAnchor},\n    'premium-smiling-fuck': '🖕'`);
  }

  replaceOptional('      <b>${earnedCount} из ${items.length}</b>', '      <b>Получено ${earnedCount} · Всего ${items.length}</b>');

  const shopPattern = /function shopActionLabel\(item = \{\}\) \{[\s\S]*?\n\}\n\nfunction renderShopCatalog\(\) \{[\s\S]*?\n\}\n\nasync function loadCatalog/;
  if (!source.includes('RED_COSMOS_SHOP_FRAMES')) {
    if (!shopPattern.test(source)) throw new Error('RED COSMOS v2 client: shop renderer not found');
    const replacement = (await fs.readFile(shopFragmentPath, 'utf8')).trimEnd();
    if (!replacement.includes('RED_COSMOS_SHOP_FRAMES') || !replacement.endsWith('async function loadCatalog')) {
      throw new Error('RED COSMOS v2 client: shop fragment is invalid');
    }
    source = source.replace(shopPattern, replacement);
  }

  source = source.replaceAll('Код постоянный и принадлежит только вам.', 'Покажите QR сотруднику перед оплатой.');
  source = source.replaceAll('QR постоянный. Не отправляйте его посторонним.', 'Не отправляйте QR посторонним.');
  source += `\n${MARKER}\n`;
}

// The old capture-phase consent listener stopped propagation for every control in #appShell
// whenever the client-side consent flag was stale or temporarily absent. That made Telegram
// look fully frozen even though auth and APIs were healthy. Consent remains an explicit modal
// and protected server routes still enforce it; navigation itself must never be globally killed.
if (LEGACY_GLOBAL_CONSENT_BLOCKER_LINE.test(source)) {
  source = source.replace(LEGACY_GLOBAL_CONSENT_BLOCKER_LINE, SAFE_CONSENT_GATE_MARKER);
} else if (!source.includes(SAFE_CONSENT_GATE_MARKER)) {
  throw new Error('RED COSMOS v2 client: global consent blocker state is unknown');
}

const forbiddenWheel = [
  'function renderWheelStatus() {\\n  if (IS_VK) return;',
  'function startWheelCountdown() {\\n  if (IS_VK ||',
  'async function loadWheelStatus() {\\n  if (IS_VK ||',
  'async function spinWheel() {\\n  if (IS_VK ||',
  'function openWheel() {\\n  if (IS_VK) return;'
];
for (const token of forbiddenWheel) {
  if (source.includes(token.replaceAll('\\n', '\n'))) throw new Error(`RED COSMOS v2 client: VK wheel guard remains: ${token}`);
}
if (!source.includes('RED_COSMOS_SHOP_FRAMES')) throw new Error('RED COSMOS v2 client: direct shop missing');
if (LEGACY_GLOBAL_CONSENT_BLOCKER_LINE.test(source)) throw new Error('RED COSMOS v2 client: executable global click blocker remains');
if (!source.includes(SAFE_CONSENT_GATE_MARKER)) throw new Error('RED COSMOS v2 client: safe consent marker missing');
await fs.writeFile(appPath, source, 'utf8');
console.log('RED COSMOS v2 client finalized: VK/TG interactions, direct shop, frames and achievement copy.');