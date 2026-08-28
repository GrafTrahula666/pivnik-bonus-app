(() => {
  'use strict';

  const EXPECTED_PRIMARY = '#c41e3a';
  const screenStack = ['client'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const isVk = () => document.documentElement.classList.contains('platform-vk');
  let originalSwitchScreen = null;
  let mutationScheduled = false;

  function normalizeColor(value) {
    const probe = document.createElement('span');
    probe.style.color = String(value || '').trim();
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }

  function verifyTheme() {
    if (document.documentElement.dataset.redCosmosVerified === '1') return;
    const configured = getComputedStyle(document.documentElement).getPropertyValue('--primary-red').trim().toLowerCase();
    console.assert(configured === EXPECTED_PRIMARY, `RED COSMOS palette mismatch: expected ${EXPECTED_PRIMARY}, got ${configured || '(empty)'}`);
    document.documentElement.classList.add('red-cosmos-v2');
    document.documentElement.dataset.redCosmosPrimary = configured;
    document.documentElement.dataset.redCosmosPrimaryComputed = normalizeColor(configured);
    document.documentElement.dataset.redCosmosVerified = '1';
  }

  function activeScreen() {
    return $('.screen.active')?.dataset.screen || 'client';
  }

  function forceScreen(target) {
    if (!target) return false;
    const screen = $(`.screen[data-screen="${CSS.escape(target)}"]`);
    if (!screen) return false;
    $$('.screen').forEach((node) => node.classList.toggle('active', node === screen));
    $$('.bottom-nav [data-target]').forEach((button) => button.classList.toggle('active', button.dataset.target === target));
    $('#appShell')?.classList.toggle('service-mode', target === 'staff' || target === 'admin');
    $('#appShell')?.classList.toggle('wheel-mode', target === 'wheel');
    const scroller = $('#appShell > main');
    if (scroller) scroller.scrollTop = 0;
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}
    return true;
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
    $$('.modal-sheet > .close').forEach(makeBackButton);
    ['wheelBackButton', 'backToProfileFromStaff', 'backToProfileFromAdmin', 'profileSetupBack'].forEach((id) => makeBackButton(document.getElementById(id)));
    ['wheelBackButton', 'backToProfileFromStaff', 'backToProfileFromAdmin'].forEach((id) => {
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
    if (!isVk()) return;
    $$('.client-tip').forEach((tip) => {
      if (/QR|код.*постоян|постоян.*код/i.test(tip.textContent || '')) tip.remove();
    });
    const qrSheet = $('#qrModal .qr-sheet');
    if (qrSheet) {
      $$('p', qrSheet).forEach((paragraph) => {
        if (/постоян|многораз|один личный код/i.test(paragraph.textContent || '')) paragraph.textContent = 'Покажите QR сотруднику перед оплатой.';
      });
    }
    const help = $('#helpModal');
    if (help) {
      $$('p,li', help).forEach((node) => {
        if (/QR является постоянным|QR постоянный|многораз/i.test(node.textContent || '')) node.textContent = 'Показывайте QR сотруднику «Пивника» при начислении или списании.';
      });
    }
  }

  function adminPanelForNode(node, key) {
    if (node) node.dataset.redCosmosAdminPanel = key;
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
      const name = [item.first_name, item.username ? `@${item.username}` : ''].filter(Boolean).join(' · ') || 'Пользователь';
      if (kind === 'frames') {
        return `<div class="op-row"><span class="op-icon">◇</span><div><b>${name}</b><small>${String(item.frame_id)} · ${String(item.acquired_source || '')}${item.restored_from_legacy ? ' · восстановлено' : ''}</small></div><strong>${item.selected_frame === item.frame_id ? 'Выбрана' : 'Есть'}</strong></div>`;
      }
      return `<div class="op-row"><span class="op-icon">◆</span><div><b>${name}</b><small>${String(item.achievement_code)} · ${Number(item.current_progress || 0)}/${Number(item.required_progress || 0)}</small></div><strong>${item.is_granted ? 'Получено' : 'В процессе'}</strong></div>`;
    }).join('');
  }

  async function loadGeneratedAdminPanel(key) {
    const target = $(`[data-red-cosmos-admin-list="${key}"]`);
    if (!target || typeof window.api !== 'function') return;
    target.className = 'operation-list empty-state';
    target.textContent = 'Загрузка…';
    try {
      const data = await window.api(key === 'frames' ? '/api/admin/frames' : '/api/admin/achievements-v2');
      renderAdminRows(target, key === 'frames' ? (data.frames || []) : (data.achievements || []), key);
    } catch (error) {
      target.textContent = error?.message || 'Не удалось загрузить данные';
    }
  }

  function installAdminTabs() {
    const admin = $('.screen[data-screen="admin"]');
    if (!admin || $('.red-cosmos-admin-tabs', admin)) return;
    const head = $('.admin-head', admin) || admin.firstElementChild;
    if (!head) return;
    [$('.metric-grid', admin), $('.admin-quick-grid', admin)].filter(Boolean).forEach((node) => adminPanelForNode(node, 'dashboard'));
    adminPanelForNode($('#usersList')?.closest('.admin-preview-card, .card, section'), 'users');
    adminPanelForNode($('#adminOperations')?.closest('.admin-preview-card, .card, section'), 'operations');
    adminPanelForNode($('.shift-admin-card', admin), 'shift');
    adminPanelForNode($('#contentAdminCard'), 'shop');
    $$('.owner-only', admin).forEach((node) => adminPanelForNode(node, 'settings'));
    createAdminDataPanel(admin, 'achievements', 'Достижения');
    createAdminDataPanel(admin, 'frames', 'Рамки пользователей');

    const tabs = document.createElement('nav');
    tabs.className = 'red-cosmos-admin-tabs';
    tabs.setAttribute('aria-label', 'Разделы админ-панели');
    const definitions = [
      ['dashboard', 'Главная'], ['users', 'Пользователи'], ['operations', 'Операции'], ['shift', 'Смена'],
      ['achievements', 'Достижения'], ['shop', 'Магазин'], ['frames', 'Рамки'], ['settings', 'Настройки']
    ];
    tabs.innerHTML = definitions.map(([key, label], index) => `<button type="button" class="red-cosmos-admin-tab${index === 0 ? ' active' : ''}" data-red-cosmos-admin-tab="${key}">${label}</button>`).join('');
    head.insertAdjacentElement('afterend', tabs);
    const show = (key) => {
      $$('[data-red-cosmos-admin-panel]', admin).forEach((node) => node.classList.toggle('red-cosmos-admin-hidden', node.dataset.redCosmosAdminPanel !== key));
      $$('[data-red-cosmos-admin-tab]', tabs).forEach((button) => button.classList.toggle('active', button.dataset.redCosmosAdminTab === key));
      if (key === 'achievements' || key === 'frames') void loadGeneratedAdminPanel(key);
    };
    show('dashboard');
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-red-cosmos-admin-tab]');
      if (button) show(button.dataset.redCosmosAdminTab);
    });
    $$('[data-red-cosmos-reload]', admin).forEach((button) => button.addEventListener('click', () => loadGeneratedAdminPanel(button.dataset.redCosmosReload)));
  }

  function consentGateVisible() {
    const modal = $('#consentModal');
    return Boolean(modal?.classList.contains('open') && modal.getAttribute('aria-hidden') !== 'true');
  }

  function forceOpenModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return false;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    return true;
  }

  function callMaybe(name, ...args) {
    const fn = window[name];
    if (typeof fn !== 'function') return false;
    try {
      const result = fn(...args);
      if (result?.catch) result.catch((error) => console.warn(`RED COSMOS fallback ${name} failed:`, error));
      return true;
    } catch (error) {
      console.warn(`RED COSMOS fallback ${name} failed:`, error);
      return false;
    }
  }

  function scheduleFallback(check, action, delay = 60) {
    setTimeout(() => {
      try { if (!check()) action(); }
      catch (error) { console.warn('RED COSMOS interaction fallback failed:', error); }
    }, delay);
  }

  function installVkInteractionFallback() {
    if (!isVk() || window.__RED_COSMOS_VK_INTERACTIONS__) return;
    window.__RED_COSMOS_VK_INTERACTIONS__ = true;
    window.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button,a,[role="button"]') : null;
      if (!target || target.disabled) return;
      if (consentGateVisible() && !target.closest('#consentModal,#helpModal,#deleteAccountModal')) return;
      if (target.matches('.bottom-nav [data-target]')) {
        const screen = target.dataset.target;
        scheduleFallback(() => $(`.screen[data-screen="${CSS.escape(screen)}"]`)?.classList.contains('active'), () => callMaybe('switchScreen', screen) || forceScreen(screen), 35);
        return;
      }
      const id = target.id;
      const routes = {
        navQrButton: ['qrModal', 'showQr'],
        openShopButton: ['shopModal', null],
        openStatuses: ['statusesModal', 'renderStatuses'],
        openHelpButton: ['helpModal', null],
        openTermsFromConsent: ['helpModal', null],
        openProfileSettings: ['profileSetupModal', 'openProfileSetup'],
        profileAvatar: ['profileSetupModal', 'openProfileSetup'],
        openProfileAvatar: ['profileSetupModal', 'openProfileSetup'],
        openProfileFrames: ['profileSetupModal', 'openProfileSetup'],
        openAchievementsButton: ['achievementsModal', 'openAchievementHub'],
        openProfileAchievements: ['achievementsModal', 'openAchievementHub']
      };
      if (id === 'openWheelButton') {
        scheduleFallback(() => $('.screen[data-screen="wheel"]')?.classList.contains('active'), () => callMaybe('openWheel') || forceScreen('wheel'));
        return;
      }
      if (routes[id]) {
        const [modalId, fn] = routes[id];
        scheduleFallback(
          () => $(`#${modalId}`)?.classList.contains('open') || (id.includes('Achievements') && $('#achievementCelebrationModal')?.classList.contains('open')),
          () => {
            if (fn === 'openProfileSetup') callMaybe(fn, 1);
            else if (fn) callMaybe(fn);
            forceOpenModal(modalId);
            if (id === 'openShopButton') callMaybe('renderShopCatalog');
          }
        );
      }
    }, true);
  }

  function enhanceLeagueLabels() {
    $$('#leaderboardList .leaderboard-row small').forEach((node) => {
      if (/^(VK|Telegram|VK · Telegram)$/.test(node.textContent?.trim() || '')) node.classList.add('red-cosmos-platform-label');
    });
  }

  function runEnhancements() {
    mutationScheduled = false;
    verifyTheme();
    installScreenHistory();
    upgradeBackButtons();
    cleanVkQrCopy();
    installAdminTabs();
    installVkInteractionFallback();
    enhanceLeagueLabels();
  }

  function scheduleEnhancements() {
    if (mutationScheduled) return;
    mutationScheduled = true;
    requestAnimationFrame(runEnhancements);
  }

  function boot() {
    runEnhancements();
    new MutationObserver(scheduleEnhancements).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
