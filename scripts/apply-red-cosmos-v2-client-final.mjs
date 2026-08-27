import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'app.js');
let source = await fs.readFile(appPath, 'utf8');
const MARKER = '// RED_COSMOS_V2_FINAL_CLIENT_RUNTIME';

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
    const replacement = `const RED_COSMOS_SHOP_FRAMES = Object.freeze({
  'frame-beer-mugs': 'beer-mugs',
  'frame-beer-bottles': 'beer-bottles',
  'frame-lights': 'lights',
  'frame-premium-smiling-fuck': 'premium-smiling-fuck'
});

function shopFrameOwned(item = {}) {
  const frameId = RED_COSMOS_SHOP_FRAMES[item.code];
  if (!frameId) return false;
  return (state.profile?.availableFrames || []).some((frame) => frame.code === frameId);
}

function shopActionLabel(item = {}) {
  return shopFrameOwned(item) ? '✓ Куплено' : 'Купить';
}

async function buyShopItem(code, button = null) {
  const item = findShopItem(code);
  if (!item) throw new Error('Товар не найден.');
  if (shopFrameOwned(item)) return toast('✓ Эта рамка уже куплена.');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/shop/buy', {
      method: 'POST',
      body: JSON.stringify({ itemCode: code, requestKey: requestId() }),
      retries: 1
    });
    if (data.profile) state.profile = data.profile;
    renderProfile();
    await loadCatalog();
    toast('Рамка куплена и сохранена в профиле');
  } finally {
    const refreshed = findShopItem(code);
    if (button && !shopFrameOwned(refreshed || item)) button.disabled = false;
  }
}

function renderShopCatalog() {
  const clientList = $('#shopCatalog');
  if (clientList) {
    clientList.className = `shop-catalog${state.catalog.length ? '' : ' empty-state'}`;
    if (!state.catalog.length) {
      clientList.innerHTML = 'Каталог пока пуст';
    } else {
      clientList.innerHTML = `<div class="red-cosmos-shop-grid">${state.catalog.map((item) => {
        const owned = shopFrameOwned(item);
        const premium = item.code === 'frame-premium-smiling-fuck';
        return `<article class="shop-list-card ${premium ? 'v2-premium' : ''}">
          ${premium ? '<span class="v2-premium-badge">★ PREMIUM</span>' : ''}
          ${shopImageMarkup(item, 'shop-list-media')}
          <div class="shop-list-copy"><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.subtitle)}</p><small>${owned ? 'Навсегда в вашей коллекции' : 'Покупка за бонусы'}</small></div>
          <div class="shop-list-price"><strong>${escapeHtml(shopPriceLabel(item))}</strong><div class="shop-card-actions">
            <button class="secondary ${owned ? 'v2-owned-button' : ''}" data-shop-buy="${escapeHtml(item.code)}" type="button" ${owned ? 'disabled' : ''}>${escapeHtml(shopActionLabel(item))}</button>
          </div></div>
        </article>`;
      }).join('')}</div>`;
      bindContentImageFallbacks(clientList);
      clientList.querySelectorAll('[data-shop-buy]').forEach((button) => button.addEventListener('click', () => buyShopItem(button.dataset.shopBuy, button).catch((error) => toast(error.message))));
    }
  }
  const staffList = $('#staffShopItems');
  if (staffList) {
    const activeItems = state.catalog.filter((item) => item.active && item.priceType === 'bonus' && Number(item.bonusPrice) > 0);
    if (!activeItems.some((item) => item.code === state.selectedShopItem)) state.selectedShopItem = activeItems[0]?.code || '';
    staffList.className = `staff-shop-items${activeItems.length ? '' : ' empty-state'}`;
    staffList.innerHTML = activeItems.length ? activeItems.map((item) => `<label class="staff-shop-item"><input type="radio" name="staff-shop-item" value="${escapeHtml(item.code)}" ${item.code === state.selectedShopItem ? 'checked' : ''} /><span><b>${escapeHtml(item.title)}</b><small>${fmt(item.bonusPrice)} Б</small></span></label>`).join('') : 'Активных товаров пока нет';
    staffList.querySelectorAll('input[name="staff-shop-item"]').forEach((input) => input.addEventListener('change', () => { state.selectedShopItem = input.value; updateCalculation(); }));
  }
}

async function loadCatalog`;
    source = source.replace(shopPattern, replacement);
  }

  source = source.replaceAll('Код постоянный и принадлежит только вам.', 'Покажите QR сотруднику перед оплатой.');
  source = source.replaceAll('QR постоянный. Не отправляйте его посторонним.', 'Не отправляйте QR посторонним.');
  source += `\n${MARKER}\n`;
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
await fs.writeFile(appPath, source, 'utf8');
console.log('RED COSMOS v2 client finalized: VK wheel, direct shop, frames and achievement copy.');
