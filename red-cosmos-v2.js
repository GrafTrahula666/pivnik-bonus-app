(() => {
  'use strict';

  const EXPECTED_PRIMARY = '#c41e3a';
  const screenStack = ['client'];
  let originalSwitchScreen = null;

  function normalizeColor(value) {
    const probe = document.createElement('span');
    probe.style.color = String(value || '').trim();
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }

  function verifyTheme() {
    const configured = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary-red')
      .trim()
      .toLowerCase();
    console.assert(
      configured === EXPECTED_PRIMARY,
      `RED COSMOS palette mismatch: expected ${EXPECTED_PRIMARY}, got ${configured || '(empty)'}`
    );
    document.documentElement.classList.add('red-cosmos-v2');
    document.documentElement.dataset.redCosmosPrimary = configured;
    document.documentElement.dataset.redCosmosPrimaryComputed = normalizeColor(configured);
  }

  function activeScreen() {
    return document.querySelector('.screen.active')?.dataset.screen || 'client';
  }

  function installScreenHistory() {
    if (window.__RED_COSMOS_SCREEN_HISTORY__) return;
    const candidate = typeof window.switchScreen === 'function'
      ? window.switchScreen
      : (typeof switchScreen === 'function' ? switchScreen : null);
    if (!candidate) return;
    originalSwitchScreen = candidate;

    const wrapped = (target, options = {}) => {
      const current = activeScreen();
      if (!options.fromHistory && current && current !== target) {
        if (screenStack[screenStack.length - 1] !== current) screenStack.push(current);
        if (screenStack.length > 30) screenStack.splice(0, screenStack.length - 30);
      }
      originalSwitchScreen(target);
      if (screenStack[screenStack.length - 1] !== target) screenStack.push(target);
    };

    window.switchScreen = wrapped;
    try { switchScreen = wrapped; } catch (_) {}
    window.__RED_COSMOS_SCREEN_HISTORY__ = screenStack;
    window.__RED_COSMOS_GO_BACK__ = () => {
      const current = activeScreen();
      while (screenStack.length && screenStack[screenStack.length - 1] === current) screenStack.pop();
      const previous = screenStack.pop() || (current === 'client' ? 'profile' : 'client');
      originalSwitchScreen(previous);
      if (screenStack[screenStack.length - 1] !== previous) screenStack.push(previous);
    };
  }

  function makeBackButton(button) {
    if (!button || button.dataset.redCosmosBack === '1') return;
    button.dataset.redCosmosBack = '1';
    button.classList.add(button.closest('.modal-sheet') ? 'v2-modal-back' : 'v2-back-button');
    button.textContent = '← Назад';
    button.setAttribute('aria-label', 'Назад');
  }

  function upgradeBackButtons() {
    document.querySelectorAll('.modal-sheet > .close').forEach(makeBackButton);
    ['wheelBackButton', 'backToProfileFromStaff', 'backToProfileFromAdmin', 'profileSetupBack'].forEach((id) => makeBackButton(document.getElementById(id)));

    const wheelBack = document.getElementById('wheelBackButton');
    if (wheelBack && wheelBack.dataset.redCosmosHistoryBound !== '1') {
      wheelBack.dataset.redCosmosHistoryBound = '1';
      wheelBack.addEventListener('click', (event) => {
        if (typeof window.__RED_COSMOS_GO_BACK__ !== 'function') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.__RED_COSMOS_GO_BACK__();
      }, true);
    }
    ['backToProfileFromStaff', 'backToProfileFromAdmin'].forEach((id) => {
      const button = document.getElementById(id);
      if (!button || button.dataset.redCosmosHistoryBound === '1') return;
      button.dataset.redCosmosHistoryBound = '1';
      button.addEventListener('click', (event) => {
        if (typeof window.__RED_COSMOS_GO_BACK__ !== 'function') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.__RED_COSMOS_GO_BACK__();
      }, true);
    });
  }

  function cleanVkQrCopy() {
    const isVk = document.documentElement.classList.contains('platform-vk') || Boolean(window.IS_VK);
    if (!isVk) return;
    document.querySelectorAll('.client-tip').forEach((tip) => {
      if (/QR|код.*постоян|постоян.*код/i.test(tip.textContent || '')) tip.remove();
    });
    const qrSheet = document.querySelector('#qrModal .qr-sheet');
    if (!qrSheet) return;
    [...qrSheet.querySelectorAll('p')].forEach((paragraph) => {
      const text = paragraph.textContent || '';
      if (/постоян|многораз|один личный код/i.test(text)) {
        paragraph.textContent = 'Покажите QR сотруднику перед оплатой.';
      }
    });
  }

  function adminPanelForNode(node, key) {
    if (!node) return;
    node.dataset.redCosmosAdminPanel = key;
  }

  function createAdminDataPanel(admin, key, title) {
    let panel = admin.querySelector(`[data-red-cosmos-generated="${key}"]`);
    if (panel) return panel;
    panel = document.createElement('section');
    panel.className = 'admin-card vip-glass-card red-cosmos-generated-admin';
    panel.dataset.redCosmosAdminPanel = key;
    panel.dataset.redCosmosGenerated = key;
    panel.innerHTML = `<div class="compact-card-head"><div><span class="home-card-kicker">RED COSMOS v2</span><h2>${title}</h2></div><button class="text-btn" type="button" data-red-cosmos-reload="${key}">Обновить</button></div><div class="operation-list empty-state" data-red-cosmos-admin-list="${key}">Загрузка…</div>`;
    admin.append(panel);
    return panel;
  }

  function renderAdminRows(target, items, kind) {
    if (!target) return;
    target.className = `operation-list${items.length ? '' : ' empty-state'}`;
    if (!items.length) {
      target.textContent = kind === 'frames' ? 'Рамок пока нет' : 'Данных достижений пока нет';
      return;
    }
    target.innerHTML = items.map((item) => {
      if (kind === 'frames') {
        const name = [item.first_name, item.username ? `@${item.username}` : ''].filter(Boolean).join(' · ') || 'Пользователь';
        return `<div class="op-row"><span class="op-icon">◇</span><div><b>${String(name)}</b><small>${String(item.frame_id)} · ${String(item.acquired_source || '')}${item.restored_from_legacy ? ' · восстановлено' : ''}</small></div><strong>${item.selected_frame === item.frame_id ? 'Выбрана' : 'Есть'}</strong></div>`;
      }
      const name = [item.first_name, item.username ? `@${item.username}` : ''].filter(Boolean).join(' · ') || 'Пользователь';
      return `<div class="op-row"><span class="op-icon">◆</span><div><b>${String(name)}</b><small>${String(item.achievement_code)} · ${Number(item.current_progress || 0)}/${Number(item.required_progress || 0)}</small></div><strong>${item.is_granted ? 'Получено' : 'В процессе'}</strong></div>`;
    }).join('');
  }

  async function loadGeneratedAdminPanel(key) {
    const target = document.querySelector(`[data-red-cosmos-admin-list="${key}"]`);
    if (!target || typeof api !== 'function') return;
    target.className = 'operation-list empty-state';
    target.textContent = 'Загрузка…';
    try {
      if (key === 'achievements') {
        const data = await api('/api/admin/achievements-v2');
        renderAdminRows(target, data.achievements || [], 'achievements');
      } else if (key === 'frames') {
        const data = await api('/api/admin/frames');
        renderAdminRows(target, data.frames || [], 'frames');
      }
    } catch (error) {
      target.textContent = error?.message || 'Не удалось загрузить данные';
    }
  }

  function installAdminTabs() {
    const admin = document.querySelector('.screen[data-screen="admin"]');
    if (!admin || admin.querySelector('.red-cosmos-admin-tabs')) return;
    const head = admin.querySelector('.admin-head') || admin.firstElementChild;
    if (!head) return;

    const dashboardNodes = [admin.querySelector('.metric-grid'), admin.querySelector('.admin-quick-grid')].filter(Boolean);
    dashboardNodes.forEach((node) => adminPanelForNode(node, 'dashboard'));

    adminPanelForNode(document.querySelector('#usersList')?.closest('.admin-preview-card, .card, section'), 'users');
    adminPanelForNode(document.querySelector('#adminOperations')?.closest('.admin-preview-card, .card, section'), 'operations');
    adminPanelForNode(admin.querySelector('.shift-admin-card'), 'shift');
    adminPanelForNode(document.getElementById('contentAdminCard'), 'shop');
    admin.querySelectorAll('.owner-only').forEach((node) => adminPanelForNode(node, 'settings'));

    createAdminDataPanel(admin, 'achievements', 'Достижения');
    createAdminDataPanel(admin, 'frames', 'Рамки пользователей');

    const tabs = document.createElement('nav');
    tabs.className = 'red-cosmos-admin-tabs';
    tabs.setAttribute('aria-label', 'Разделы админ-панели');
    const definitions = [
      ['dashboard', 'Главная'],
      ['users', 'Пользователи'],
      ['operations', 'Операции'],
      ['shift', 'Смена'],
      ['achievements', 'Достижения'],
      ['shop', 'Магазин'],
      ['frames', 'Рамки'],
      ['settings', 'Настройки']
    ];
    tabs.innerHTML = definitions.map(([key, label], index) => `<button type="button" class="red-cosmos-admin-tab${index === 0 ? ' active' : ''}" data-red-cosmos-admin-tab="${key}">${label}</button>`).join('');
    head.insertAdjacentElement('afterend', tabs);

    const show = (key) => {
      admin.querySelectorAll('[data-red-cosmos-admin-panel]').forEach((node) => {
        node.classList.toggle('red-cosmos-admin-hidden', node.dataset.redCosmosAdminPanel !== key);
      });
      tabs.querySelectorAll('[data-red-cosmos-admin-tab]').forEach((button) => button.classList.toggle('active', button.dataset.redCosmosAdminTab === key));
      if (key === 'achievements' || key === 'frames') void loadGeneratedAdminPanel(key);
    };
    show('dashboard');
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-red-cosmos-admin-tab]');
      if (!button) return;
      show(button.dataset.redCosmosAdminTab);
    });
    admin.querySelectorAll('[data-red-cosmos-reload]').forEach((button) => button.addEventListener('click', () => loadGeneratedAdminPanel(button.dataset.redCosmosReload)));
  }

  function runEnhancements() {
    verifyTheme();
    installScreenHistory();
    upgradeBackButtons();
    cleanVkQrCopy();
    installAdminTabs();
  }

  function boot() {
    runEnhancements();
    const observer = new MutationObserver(() => {
      requestAnimationFrame(runEnhancements);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
