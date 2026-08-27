(() => {
  'use strict';

  const V22_MARKER = 'pivnik-v22-ui-ready';
  if (document.documentElement.classList.contains(V22_MARKER)) return;
  document.documentElement.classList.add(V22_MARKER);

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const isVk = () => document.documentElement.classList.contains('platform-vk');

  function upgradeModalBackButtons() {
    $$('.modal-sheet > .close').forEach((button) => {
      if (button.dataset.v22BackReady === '1') return;
      button.dataset.v22BackReady = '1';
      button.classList.add('v22-modal-back');
      button.textContent = '← Назад';
      button.setAttribute('aria-label', 'Назад');
      button.removeAttribute('title');
    });
  }

  function attachHistoryBack(button) {
    if (!button || button.dataset.v22HistoryBackReady === '1') return;
    button.dataset.v22HistoryBackReady = '1';
    button.addEventListener('click', (event) => {
      if (typeof window.__PIVNIK_GO_BACK__ !== 'function') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.__PIVNIK_GO_BACK__();
    }, true);
  }

  function upgradeExistingBackButtons() {
    const wheelBack = $('#wheelBackButton');
    if (wheelBack && wheelBack.dataset.v22BackReady !== '1') {
      wheelBack.dataset.v22BackReady = '1';
      wheelBack.classList.remove('icon-btn');
      wheelBack.classList.add('v22-back-button');
      wheelBack.innerHTML = '<span aria-hidden="true">←</span><span>Назад</span>';
      wheelBack.setAttribute('aria-label', 'Назад');
    }
    attachHistoryBack(wheelBack);

    ['#backToProfileFromAdmin', '#backToProfileFromStaff'].forEach((selector) => {
      const button = $(selector);
      if (!button) return;
      if (button.dataset.v22BackReady !== '1') {
        button.dataset.v22BackReady = '1';
        button.classList.add('v22-back-button');
        button.textContent = '← Назад';
        button.setAttribute('aria-label', 'Назад');
      }
      attachHistoryBack(button);
    });
  }

  function setupAdminTabs() {
    const admin = $('.screen[data-screen="admin"]');
    if (!admin || $('.v22-admin-tabs', admin)) return;

    const head = $('.admin-head', admin);
    if (!head) return;

    const quick = $('.admin-quick-grid', admin);
    const metrics = $('.metric-grid', admin);
    const shift = $('.shift-admin-card', admin);
    const settings = $('.owner-only', admin);
    const content = $('#contentAdminCard', admin);
    const previews = $$('.admin-preview-card', admin);

    const panelMap = new Map();
    [quick, metrics, ...previews].filter(Boolean).forEach((node) => {
      node.dataset.v22AdminPanel = 'dashboard';
      panelMap.set(node, 'dashboard');
    });
    if (shift) { shift.dataset.v22AdminPanel = 'shift'; panelMap.set(shift, 'shift'); }
    if (content) { content.dataset.v22AdminPanel = 'shop'; panelMap.set(content, 'shop'); }
    if (settings) { settings.dataset.v22AdminPanel = 'settings'; panelMap.set(settings, 'settings'); }

    const tabs = document.createElement('div');
    tabs.className = 'v22-admin-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = [
      ['dashboard', 'Главная'],
      ['users', 'Пользователи'],
      ['transactions', 'Операции'],
      ['shift', 'Смена'],
      ['shop', 'Магазин'],
      ['achievements', 'Достижения'],
      ['inquiries', 'Обращения'],
      ['settings', 'Настройки']
    ].map(([key, title], index) => `<button type="button" role="tab" class="v22-admin-tab${index === 0 ? ' active' : ''}" data-v22-admin-tab="${key}">${title}</button>`).join('');
    head.insertAdjacentElement('afterend', tabs);

    const showPanel = (key) => {
      panelMap.forEach((panelKey, node) => {
        node.classList.toggle('v22-admin-hidden', panelKey !== key);
      });
      $$('.v22-admin-tab', tabs).forEach((button) => {
        button.classList.toggle('active', button.dataset.v22AdminTab === key);
        button.setAttribute('aria-selected', button.dataset.v22AdminTab === key ? 'true' : 'false');
      });
    };

    showPanel('dashboard');

    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-v22-admin-tab]');
      if (!button) return;
      const key = button.dataset.v22AdminTab;
      const modalLaunchers = {
        users: '#openAllUsers',
        transactions: '#openAllTransactions',
        inquiries: '#openAllInquiries'
      };
      if (modalLaunchers[key]) {
        $(modalLaunchers[key], admin)?.click();
        return;
      }
      if (key === 'achievements') {
        $('#openAchievementsButton')?.click();
        return;
      }
      showPanel(key);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function cleanVkQrCopy() {
    if (!isVk()) return;
    const modal = $('#qrModal');
    if (modal && modal.dataset.v22VkQrReady !== '1') {
      modal.dataset.v22VkQrReady = '1';
      $('.qr-warning', modal)?.setAttribute('hidden', '');
      const intro = $('p', modal);
      if (intro) intro.textContent = 'Покажите QR сотруднику «Пивника» для начисления или списания.';
    }

    $$('.client-tip').forEach((tip) => {
      if (/qr\s+постоян/i.test(tip.textContent || '')) tip.remove();
    });

    const help = $('#helpModal');
    if (help && help.dataset.v22VkQrReady !== '1') {
      help.dataset.v22VkQrReady = '1';
      $$('p, li', help).forEach((node) => {
        const text = node.textContent || '';
        if (!/QR является постоянным/i.test(text)) return;
        node.textContent = 'Показывайте свой QR сотруднику «Пивника» при начислении или списании.';
      });
    }
  }

  function enhanceLeaderboardPlatformLabels() {
    $$('#leaderboardList .leaderboard-row').forEach((row) => {
      const detail = $('div', row);
      const small = $('small', detail);
      if (!detail || !small || small.classList.contains('v22-platform-label')) return;
      const text = small.textContent?.trim() || '';
      if (!/^(VK|Telegram|VK · Telegram)$/.test(text)) return;
      small.classList.add('v22-platform-label');
    });
  }

  let scheduled = false;
  function run() {
    scheduled = false;
    upgradeModalBackButtons();
    upgradeExistingBackButtons();
    setupAdminTabs();
    cleanVkQrCopy();
    enhanceLeaderboardPlatformLabels();
  }

  function scheduleRun() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(run);
  }

  run();
  new MutationObserver(scheduleRun).observe(document.body, { childList: true, subtree: true });
})();
