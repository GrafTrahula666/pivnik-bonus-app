(() => {
  'use strict';
  const MARKER = 'PIVNIK_FINAL_UI_HOTFIX_20260827';
  if (window.__PIVNIK_FINAL_UI_HOTFIX__) return;
  window.__PIVNIK_FINAL_UI_HOTFIX__ = MARKER;

  const qs = (s, root = document) => root.querySelector(s);
  const qsa = (s, root = document) => [...root.querySelectorAll(s)];
  const screenHistory = ['client'];
  let enhancementQueued = false;

  function currentProfile() {
    try { return typeof state !== 'undefined' ? state.profile : null; } catch (_) { return null; }
  }

  function safeCall(name, ...args) {
    try {
      const fn = window[name];
      if (typeof fn !== 'function') return false;
      const result = fn(...args);
      if (result && typeof result.catch === 'function') result.catch((error) => console.warn(`${MARKER}:${name}`, error));
      return true;
    } catch (error) {
      console.warn(`${MARKER}:${name}`, error);
      return false;
    }
  }

  function activeScreenName() {
    return qs('.screen.active')?.dataset.screen || 'client';
  }

  function forceScreen(target, { remember = true } = {}) {
    const next = qs(`.screen[data-screen="${CSS.escape(String(target || ''))}"]`);
    if (!next) return false;
    const current = activeScreenName();
    if (remember && current !== target) {
      if (screenHistory[screenHistory.length - 1] !== current) screenHistory.push(current);
      if (screenHistory.length > 30) screenHistory.splice(0, screenHistory.length - 30);
    }
    qsa('.screen').forEach((node) => node.classList.toggle('active', node === next));
    qsa('.bottom-nav [data-target]').forEach((button) => button.classList.toggle('active', button.dataset.target === target));
    qs('#appShell')?.classList.toggle('service-mode', target === 'staff' || target === 'admin');
    qs('#appShell')?.classList.toggle('wheel-mode', target === 'wheel');
    const scroller = qs('#appShell > main');
    if (scroller) scroller.scrollTop = 0;
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {}

    if (target === 'actions') safeCall('renderPromotions');
    if (target === 'league') safeCall('renderLeaderboard');
    if (target === 'profile') safeCall('showHistory');
    if (target === 'wheel') {
      safeCall('renderWheelArtwork');
      safeCall('loadWheelStatus');
    }
    if (target === 'staff') safeCall('openStaffWorkspace');
    if (target === 'admin') safeCall('loadAdmin');
    return true;
  }

  function goBack() {
    const current = activeScreenName();
    while (screenHistory.length && screenHistory[screenHistory.length - 1] === current) screenHistory.pop();
    const previous = screenHistory.pop() || 'client';
    forceScreen(previous, { remember: false });
  }

  function forceOpenModal(id) {
    const modal = qs(`#${CSS.escape(id)}`);
    if (!modal) return false;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    return true;
  }

  function forceCloseModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function cleanQrUi() {
    const isVk = document.documentElement.classList.contains('platform-vk');
    const sheet = qs('#qrModal .qr-sheet');
    if (!sheet) return;
    const title = sheet.querySelector('h2');
    if (title && /личн|карта|код/i.test(title.textContent || '')) title.textContent = 'QR для бонусной операции';
    qsa('p', sheet).forEach((p) => {
      if (/постоян|многораз|один личный код|принадлежит только/i.test(p.textContent || '')) {
        p.textContent = 'Покажите QR сотруднику перед оплатой.';
      }
    });
    if (isVk) {
      qs('#qrToken')?.setAttribute('aria-hidden', 'true');
      qs('#copyQrCode')?.setAttribute('aria-hidden', 'true');
    }
  }

  function fixOwnerUi() {
    const profile = currentProfile();
    const unlimited = Boolean(profile?.unlimitedBonus || profile?.vipStatusLocked);
    document.documentElement.classList.toggle('owner-unlimited-ui', unlimited);
    if (!unlimited) return;
    const statusName = profile?.status?.name || 'Владелец';
    const bonus = qs('#bonusPercent');
    if (bonus && bonus.textContent !== '∞') bonus.textContent = '∞';
    const profileStatus = qs('#profileStatus');
    const desired = `${statusName} · ∞`;
    if (profileStatus && profileStatus.textContent !== desired) profileStatus.textContent = desired;
    const progress = qs('#statusProgressText');
    if (progress && progress.textContent !== 'Без лимита') progress.textContent = 'Без лимита';
    const next = qs('#nextRewardText');
    if (next && next.textContent !== '∞ начисление') next.textContent = '∞ начисление';
  }

  function ensureBackButtons() {
    const screens = ['actions', 'league', 'profile', 'wheel', 'staff', 'admin'];
    for (const name of screens) {
      const screen = qs(`.screen[data-screen="${name}"]`);
      if (!screen) continue;
      let button = name === 'wheel' ? qs('#wheelBackButton', screen)
        : name === 'staff' ? qs('#backToProfileFromStaff', screen)
        : name === 'admin' ? qs('#backToProfileFromAdmin', screen)
        : qs(':scope > .final-screen-back', screen);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'final-screen-back';
        screen.prepend(button);
      }
      button.classList.add('final-back-button', 'final-screen-back');
      button.textContent = '← Назад';
      button.setAttribute('aria-label', 'Назад');
      button.dataset.finalBack = 'screen';
    }
    qsa('.modal-sheet > .close').forEach((button) => {
      button.classList.add('final-back-button');
      button.textContent = '← Назад';
      button.setAttribute('aria-label', 'Назад');
      button.dataset.finalBack = 'modal';
    });
  }

  function ensureShopImages() {
    qsa('#shopCatalog img').forEach((image) => {
      image.loading = 'eager';
      if (image.dataset.finalImageGuard) return;
      image.dataset.finalImageGuard = '1';
      image.addEventListener('error', () => {
        const src = image.getAttribute('src') || '';
        console.error(`${MARKER}:shop-image-failed`, src);
      }, { once: true });
    });
  }

  function enhance() {
    enhancementQueued = false;
    ensureBackButtons();
    cleanQrUi();
    fixOwnerUi();
    ensureShopImages();
    document.documentElement.dataset.finalUiHotfix = 'active';
  }

  function queueEnhance() {
    if (enhancementQueued) return;
    enhancementQueued = true;
    requestAnimationFrame(enhance);
  }

  function handleKnownControl(target, event) {
    if (!target || target.disabled) return false;

    if (target.dataset.finalBack === 'screen') {
      event.preventDefault(); event.stopImmediatePropagation(); goBack(); return true;
    }
    if (target.dataset.finalBack === 'modal') {
      event.preventDefault(); event.stopImmediatePropagation(); forceCloseModal(target.closest('.modal')); return true;
    }

    if (target.matches('.bottom-nav [data-target]')) {
      event.preventDefault(); event.stopImmediatePropagation();
      forceScreen(target.dataset.target);
      return true;
    }

    const id = target.id;
    if (id === 'openWheelButton') {
      event.preventDefault(); event.stopImmediatePropagation(); forceScreen('wheel'); return true;
    }
    if (id === 'openLeaderboardButton') {
      event.preventDefault(); event.stopImmediatePropagation(); forceScreen('league'); return true;
    }
    if (id === 'openPromosButton') {
      event.preventDefault(); event.stopImmediatePropagation(); forceScreen('actions'); return true;
    }
    if (id === 'openShopButton') {
      event.preventDefault(); event.stopImmediatePropagation();
      safeCall('renderShopCatalog');
      forceOpenModal('shopModal');
      queueEnhance();
      return true;
    }
    if (id === 'openStatuses') {
      event.preventDefault(); event.stopImmediatePropagation(); safeCall('renderStatuses'); forceOpenModal('statusesModal'); return true;
    }
    if (id === 'openAchievementsButton' || id === 'openProfileAchievements') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!safeCall('openAchievementHub')) forceOpenModal('achievementsModal');
      return true;
    }
    if (id === 'openProfileSettings' || id === 'profileAvatar' || id === 'openProfileAvatar' || id === 'openProfileFrames') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!safeCall('openProfileSetup', 1)) forceOpenModal('profileSetupModal');
      return true;
    }
    if (id === 'openHelpButton') {
      event.preventDefault(); event.stopImmediatePropagation(); forceOpenModal('helpModal'); return true;
    }
    return false;
  }

  // Window capture runs before the legacy document-level click gate and makes
  // navigation deterministic in both Telegram and VK WebViews.
  window.addEventListener('click', (event) => {
    const origin = event.composedPath?.()[0] || event.target;
    const element = origin instanceof Element ? origin.closest('button,a,[role="button"]') : null;
    if (!element) return;
    const consent = qs('#consentModal.open');
    if (consent && !element.closest('#consentModal,#helpModal')) return;
    handleKnownControl(element, event);
  }, { capture: true });

  window.addEventListener('pivnik:boot-complete', queueEnhance);
  window.addEventListener('pageshow', queueEnhance);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueEnhance(); });

  function boot() {
    enhance();
    new MutationObserver(queueEnhance).observe(document.body, { childList: true, subtree: true, characterData: true });
    console.info(MARKER, 'active');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
