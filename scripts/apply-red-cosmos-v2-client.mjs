import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'app.js');
let source = await fs.readFile(appPath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`RED COSMOS v2 client: missing ${label}`);
  source = source.replace(from, to);
}

function replacePattern(pattern, replacement, marker, label) {
  if (marker && source.includes(marker)) return;
  if (!pattern.test(source)) throw new Error(`RED COSMOS v2 client: missing ${label}`);
  pattern.lastIndex = 0;
  source = source.replace(pattern, replacement);
}

replaceRequired("  selectedShopItem: 'craft-05',", "  selectedShopItem: 'frame-beer-mugs',", 'default shop item');

// The same wheel UI and API are used on both platforms.
replaceRequired("function renderWheelStatus() {\n  if (IS_VK) return;", "function renderWheelStatus() {", 'VK wheel status guard');
replaceRequired("function startWheelCountdown() {\n  if (IS_VK || state.wheel.countdownTimer) return;", "function startWheelCountdown() {\n  if (state.wheel.countdownTimer) return;", 'VK wheel countdown guard');
replaceRequired("async function loadWheelStatus() {\n  if (IS_VK || !state.token || !state.profile?.termsAccepted) return null;", "async function loadWheelStatus() {\n  if (!state.token || !state.profile?.termsAccepted) return null;", 'VK wheel load guard');
replaceRequired("async function spinWheel() {\n  if (IS_VK || state.wheel.busy) return;", "async function spinWheel() {\n  if (state.wheel.busy) return;", 'VK wheel spin guard');
replaceRequired("function openWheel() {\n  if (IS_VK) return;", "function openWheel() {", 'VK wheel open guard');
replaceRequired("  if (!IS_VK) void loadWheelStatus().catch((error) => console.warn('Wheel status refresh skipped:', error));", "  void loadWheelStatus().catch((error) => console.warn('Wheel status refresh skipped:', error));", 'VK refresh wheel');
if (source.includes("  if (!IS_VK) jobs.push(loadWheelStatus());")) {
  source = source.replace("  if (!IS_VK) jobs.push(loadWheelStatus());", "  jobs.push(loadWheelStatus());");
}

// New frame classes and orbit symbols.
replaceRequired(
  "  if (entity.profileFrame === 'vladislav') return 'avatar-frame avatar-frame-vladislav';\n  return '';",
  "  if (entity.profileFrame === 'vladislav') return 'avatar-frame avatar-frame-vladislav';\n  if (entity.profileFrame === 'beer-mugs') return 'avatar-frame avatar-frame-beer-mugs';\n  if (entity.profileFrame === 'beer-bottles') return 'avatar-frame avatar-frame-beer-bottles';\n  if (entity.profileFrame === 'lights') return 'avatar-frame avatar-frame-lights';\n  if (entity.profileFrame === 'premium-smiling-fuck') return 'avatar-frame avatar-frame-premium-smiling-fuck';\n  return '';",
  'new avatar frame classes'
);

replaceRequired(
  `  if (entity.profileFrame === 'vladislav') {
    const poops = Array.from({ length: 12 }, () => '💩');
    return '<span class="avatar-orbit vladislav-orbit" aria-hidden="true">' + poops.map((poop, index) => '<i style="--orbit-index:' + index + ';--counter-angle:' + (-index * 30) + 'deg"><span>' + poop + '</span></i>').join('') + '</span>';
  }
  return '';`,
  `  if (entity.profileFrame === 'vladislav') {
    const poops = Array.from({ length: 12 }, () => '💩');
    return '<span class="avatar-orbit vladislav-orbit" aria-hidden="true">' + poops.map((poop, index) => '<i style="--orbit-index:' + index + ';--counter-angle:' + (-index * 30) + 'deg"><span>' + poop + '</span></i>').join('') + '</span>';
  }
  const redCosmosFrameSymbols = {
    'beer-mugs': '🍺',
    'beer-bottles': '🍾',
    lights: '✦',
    'premium-smiling-fuck': '🖕'
  };
  if (redCosmosFrameSymbols[entity.profileFrame]) {
    const symbol = redCosmosFrameSymbols[entity.profileFrame];
    return '<span class="avatar-orbit red-cosmos-frame-orbit" aria-hidden="true">' + Array.from({ length: 8 }, (_, index) => '<i style="--orbit-index:' + index + '">' + symbol + '</i>').join('') + '</span>';
  }
  return '';`,
  'new avatar frame orbit'
);

// Stop presenting a misleading "X из Y" summary as progress. Individual cards
// continue to show their true server progress; earned cards show "Получено".
replaceRequired(
  "      <b>${earnedCount} из ${items.length}</b>",
  "      <b>Получено ${earnedCount} · Всего ${items.length}</b>",
  'achievement summary copy'
);

replacePattern(
  /function shopActionLabel\(item = \{\}\) \{[\s\S]*?\n\}\n\nfunction renderShopCatalog\(\) \{[\s\S]*?\n\}\n\nasync function loadCatalog/,
  `const RED_COSMOS_SHOP_FRAMES = Object.freeze({
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
  if (shopFrameOwned(item)) return '✓ Куплено';
  if (RED_COSMOS_SHOP_FRAMES[item.code] && item.priceType === 'bonus') return 'Купить';
  return 'Уточнить по кружке';
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
    if (button && !shopFrameOwned(item)) button.disabled = false;
  }
}

function renderShopCatalog() {
  const clientList = $('#shopCatalog');
  if (clientList) {
    clientList.className = \`shop-catalog${'${state.catalog.length ? \'\' : \' empty-state\'}'}\`;
    if (!state.catalog.length) {
      clientList.innerHTML = 'Каталог пока пуст';
    } else {
      const categoryOrder = ['limited', 'profile', 'other'];
      const groups = categoryOrder
        .map((category) => ({ category, items: state.catalog.filter((item) => (item.category || 'other') === category) }))
        .filter((group) => group.items.length);
      clientList.innerHTML = groups.map((group) => {
        const meta = SHOP_CATEGORY_META[group.category] || SHOP_CATEGORY_META.other;
        return \`<section class="shop-category" data-shop-category="${'${escapeHtml(group.category)}'}">
          <div class="shop-category-head"><div><span>${'${escapeHtml(meta.subtitle)}'}</span><h3>${'${escapeHtml(meta.title)}'}</h3></div><b>${'${group.items.length}'}</b></div>
          <div class="shop-category-grid">${'${group.items.map((item) => {'}
            const owned = shopFrameOwned(item);
            const direct = Boolean(RED_COSMOS_SHOP_FRAMES[item.code] && item.priceType === 'bonus');
            const premium = item.code === 'frame-premium-smiling-fuck';
            return \`<article class="shop-list-card ${'${premium ? \'v2-premium\' : \'\'}'}">
              ${'${premium ? \'<span class="v2-premium-badge">★ PREMIUM</span>\' : \'\'}'}
              ${'${shopImageMarkup(item, \'shop-list-media\')}'}
              <div class="shop-list-copy"><b>${'${escapeHtml(item.title)}'}</b><p>${'${escapeHtml(item.subtitle)}'}</p><small>${'${owned ? \'Навсегда в вашей коллекции\' : direct ? \'Покупка за бонусы\' : \'Индивидуальный заказ\'}'}</small></div>
              <div class="shop-list-price"><strong>${'${escapeHtml(shopPriceLabel(item))}'}</strong><div class="shop-card-actions">
                ${'${direct ? `<button class="secondary ${owned ? \'v2-owned-button\' : \'\'}" data-shop-buy="${escapeHtml(item.code)}" type="button" ${owned ? \'disabled\' : \'\'}>${escapeHtml(shopActionLabel(item))}</button>` : `<button class="secondary" data-shop-inquiry="${escapeHtml(item.code)}" type="button">${escapeHtml(shopActionLabel(item))}</button>`}'}
                ${'${direct ? \'\' : `<button class="text-btn" data-shop-chat="${escapeHtml(item.code)}" type="button">Написать Кириллу</button>`}'}
              </div></div>
            </article>\`;
          }).join(\'\')}'}</div>
        </section>\`;
      }).join('');
      bindContentImageFallbacks(clientList);
      clientList.querySelectorAll('[data-shop-buy]').forEach((button) => button.addEventListener('click', () => buyShopItem(button.dataset.shopBuy, button).catch((error) => toast(error.message))));
      clientList.querySelectorAll('[data-shop-inquiry]').forEach((button) => button.addEventListener('click', () => openShopInquiry(button.dataset.shopInquiry)));
      clientList.querySelectorAll('[data-shop-chat]').forEach((button) => button.addEventListener('click', () => contactOwnerAboutItem(button.dataset.shopChat)));
    }
  }
  const staffList = $('#staffShopItems');
  if (staffList) {
    const activeItems = state.catalog.filter((item) => item.active && item.priceType === 'bonus' && Number(item.bonusPrice) > 0);
    if (!activeItems.some((item) => item.code === state.selectedShopItem)) state.selectedShopItem = activeItems[0]?.code || '';
    staffList.className = \`staff-shop-items${'${activeItems.length ? \'\' : \' empty-state\'}'}\`;
    staffList.innerHTML = activeItems.length ? activeItems.map((item) => \`<label class="staff-shop-item"><input type="radio" name="staff-shop-item" value="${'${escapeHtml(item.code)}'}" ${'${item.code === state.selectedShopItem ? \'checked\' : \'\'}'} /><span><b>${'${escapeHtml(item.title)}'}</b><small>${'${fmt(item.bonusPrice)}'} Б</small></span></label>\`).join('') : 'Активных товаров пока нет';
    staffList.querySelectorAll('input[name="staff-shop-item"]').forEach((input) => input.addEventListener('change', () => {
      state.selectedShopItem = input.value;
      updateCalculation();
    }));
  }
}

async function loadCatalog`,
  'RED_COSMOS_SHOP_FRAMES',
  'direct shop rendering'
);

source += source.includes('// RED_COSMOS_V2_CLIENT') ? '' : '\n// RED_COSMOS_V2_CLIENT\n';
await fs.writeFile(appPath, source, 'utf8');
console.log('RED COSMOS v2 client materialized: working VK wheel, direct shop, frames and achievement display.');
