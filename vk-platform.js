(() => {
  'use strict';

  const bridge = window.vkBridge;
  const originalFetch = window.fetch.bind(window);
  const launchParams = window.location.search.replace(/^\?/, '');
  const launchSearch = new URLSearchParams(launchParams);
  const launchVkUserId = String(launchSearch.get('vk_user_id') || '').trim();
  const BRIDGE_INIT_TIMEOUT_MS = 1600;
  const BRIDGE_PROFILE_TIMEOUT_MS = 2200;
  let vkUser = null;
  let bridgeInitialized = false;
  let consentExplicit = false;
  let consentRequired = false;
  let consentObserver = null;

  /*
   * Telegram and VK never share a browser session. VK sessions are scoped by
   * the signed VK user id, so changing accounts selects another storage key
   * without forcing every returning user through the full auth transaction.
   */
  const storagePrefix = `pivnik_vk_${launchVkUserId || 'unknown'}_`;
  window.__PIVNIK_STORAGE_PREFIX__ = storagePrefix;
  try {
    localStorage.removeItem('pivnik_session');
    localStorage.removeItem('pivnik_staff_session');
    localStorage.removeItem(`${storagePrefix}pivnik_session`);
    localStorage.removeItem(`${storagePrefix}pivnik_staff_session`);
  } catch (_) {}

  function withTimeout(promise, timeoutMs, message) {
    let timer = 0;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]).finally(() => window.clearTimeout(timer));
  }

  const bridgeReady = (async () => {
    if (!bridge?.send) {
      console.warn('VK Bridge unavailable; signed launch authentication will be used.');
      return false;
    }
    try {
      bridgeInitialized = true;
      await withTimeout(
        bridge.send('VKWebAppInit'),
        BRIDGE_INIT_TIMEOUT_MS,
        'VK не подтвердил запуск приложения вовремя.'
      );
      return true;
    } catch (error) {
      /*
       * The signed launch parameters are sufficient for authentication.
       * Some VK iOS shells send no acknowledgement even though Init was
       * delivered, so an absent acknowledgement must not freeze the app.
       */
      console.warn('VK init acknowledgement unavailable; continuing:', error);
      return false;
    }
  })();

  const profileReady = (async () => {
    await bridgeReady;
    if (!bridge?.send) return null;
    try {
      vkUser = await withTimeout(
        bridge.send('VKWebAppGetUserInfo'),
        BRIDGE_PROFILE_TIMEOUT_MS,
        'VK не передал данные профиля вовремя.'
      );
    } catch (error) {
      console.warn('VK user info unavailable:', error);
      vkUser = null;
    }
    if (vkUser?.id && launchVkUserId && String(vkUser.id) !== launchVkUserId) {
      console.warn('VK profile does not match signed launch parameters; profile data ignored.');
      vkUser = null;
    }
    return vkUser;
  })();

  function sendBridge(method, params) {
    if (!bridge?.send) return Promise.reject(new Error('VK Bridge unavailable'));
    return bridgeReady.then(() => bridge.send(method, params));
  }

  function normalizeScannedCode(value) {
    let code = String(value || '').trim();
    if (!code) return '';
    try { code = decodeURIComponent(code); } catch (_) {}
    code = code.replace(/^["']|["']$/g, '').trim();

    try {
      const parsed = JSON.parse(code);
      if (parsed && typeof parsed === 'object') {
        code = String(parsed.payload || parsed.code || parsed.qr || code).trim();
      }
    } catch (_) {}

    try {
      const url = new URL(code);
      code = String(
        url.searchParams.get('payload')
        || url.searchParams.get('code')
        || url.searchParams.get('qr')
        || code
      ).trim();
    } catch (_) {}

    return code.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  }

  const webAppCompat = {
    initData: 'vk',
    platform: 'vk',
    colorScheme: 'dark',
    ready() { void bridgeReady.catch(() => {}); },
    expand() {},
    isVersionAtLeast() { return true; },
    setHeaderColor() {},
    setBackgroundColor() {},
    setBottomBarColor() {},
    HapticFeedback: {
      impactOccurred(style = 'light') {
        const supported = ['light', 'medium', 'heavy'].includes(style) ? style : 'light';
        void sendBridge('VKWebAppTapticImpactOccurred', { style: supported }).catch(() => {});
      }
    },
    showScanQrPopup(_options, callback) {
      void sendBridge('VKWebAppOpenCodeReader')
        .then((data) => {
          const code = normalizeScannedCode(data?.code_data || data?.code || '');
          if (code) return callback?.(code);
          window.dispatchEvent(new CustomEvent('pivnik:vk-scanner-error'));
          return false;
        })
        .catch((error) => {
          console.warn('VK code reader failed:', error);
          window.dispatchEvent(new CustomEvent('pivnik:vk-scanner-error'));
        });
    },
    closeScanQrPopup() {},
    openTelegramLink(url) {
      try { window.open(url, '_blank', 'noopener,noreferrer'); }
      catch { window.location.href = url; }
    }
  };

  window.Telegram = { ...(window.Telegram || {}), WebApp: webAppCompat };
  window.__PIVNIK_PLATFORM__ = 'vk';
  window.__PIVNIK_VK_USER_ID__ = launchVkUserId;
  document.documentElement.classList.add('vk-mini-app');

  function updateConsentState(profile) {
    if (!profile || typeof profile !== 'object') return;
    consentRequired = profile.termsAccepted !== true;
    if (consentRequired) scheduleConsentGate();
    else stopConsentGate();
  }

  async function inspectApiResponse(response) {
    try {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = await response.clone().json();
      if (data?.profile) updateConsentState(data.profile);
    } catch (_) {}
  }

  window.fetch = async (input, init = {}) => {
    const requestUrl = typeof input === 'string' ? input : input?.url || '';
    const pathname = (() => {
      try { return new URL(requestUrl, window.location.href).pathname; }
      catch { return requestUrl; }
    })();

    if (pathname === '/api/auth') {
      const headers = new Headers(init.headers || {});
      headers.set('content-type', 'application/json');
      const response = await originalFetch(input, {
        ...init,
        headers,
        body: JSON.stringify({
          platform: 'vk',
          launchParams,
          user: vkUser
        })
      });
      void inspectApiResponse(response);
      return response;
    }

    if (pathname === '/api/me/consent' && !consentExplicit) {
      return Promise.reject(new Error('Согласие можно подтвердить только кнопкой пользователя.'));
    }

    const response = await originalFetch(input, init);
    if (pathname === '/api/me' || pathname === '/api/me/consent') {
      void inspectApiResponse(response);
      if (pathname === '/api/me/consent') consentExplicit = false;
    }
    return response;
  };

  function openConsentGate() {
    if (!consentRequired) return;
    const modal = document.getElementById('consentModal');
    const shell = document.getElementById('appShell');
    if (!modal || shell?.classList.contains('hidden')) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function scheduleConsentGate() {
    window.setTimeout(openConsentGate, 80);
    window.setTimeout(openConsentGate, 500);
    if (consentObserver || !document.body) return;
    consentObserver = new MutationObserver(() => openConsentGate());
    consentObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-hidden']
    });
  }

  function stopConsentGate() {
    consentRequired = false;
    consentObserver?.disconnect();
    consentObserver = null;
  }

  function applyVkLabels() {
    const eyebrow = document.getElementById('eyebrow');
    if (eyebrow) eyebrow.textContent = 'VK Mini App';
    const scannerHint = document.getElementById('scannerPlatformHint');
    if (scannerHint) scannerHint.textContent = 'Откроется штатный сканер VK';
    const clearStaff = document.getElementById('clearStaffButton');
    if (clearStaff) clearStaff.textContent = 'Работать под текущим VK-аккаунтом';
    const privacyCopy = document.getElementById('privacyPlatformCopy');
    if (privacyCopy) {
      privacyCopy.textContent = 'Для работы приложение использует VK ID и привязанные идентификаторы, имя, username, роль пользователя, бонусный баланс и историю операций.';
    }
    const switchHelp = document.getElementById('platformSwitchHelp');
    if (switchHelp) {
      const title = document.createElement('strong');
      title.textContent = 'Что делать, если сменился VK-аккаунт?';
      switchHelp.replaceChildren(
        title,
        document.createElement('br'),
        document.createTextNode(
          'Откройте приложение под нужным аккаунтом VK. Чужая сессия повторно не используется.'
        )
      );
    }
    const userSearch = document.getElementById('userSearch');
    if (userSearch) userSearch.placeholder = 'Имя, username, VK или Telegram ID';
  }

  function syncVisualViewport() {
    const height = Math.max(320, Math.round(window.visualViewport?.height || window.innerHeight));
    document.documentElement.style.setProperty('--pivnik-viewport-height', `${height}px`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.id = 'vk-layout-hardening';
    style.textContent = `
      html.vk-mini-app, html.vk-mini-app body { height: 100%; overflow: hidden !important; }
      html.vk-mini-app .app-shell {
        height: var(--pivnik-viewport-height, 100dvh) !important;
        min-height: var(--pivnik-viewport-height, 100dvh) !important;
        overflow: hidden !important;
        display: flex;
        flex-direction: column;
        padding-bottom: 0 !important;
      }
      html.vk-mini-app .app-shell.hidden { display: none !important; }
      html.vk-mini-app .topbar { flex: 0 0 auto; }
      html.vk-mini-app .app-shell > main {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto !important;
        overscroll-behavior-y: contain;
        -webkit-overflow-scrolling: touch;
        padding-bottom: calc(104px + env(safe-area-inset-bottom));
      }
      html.vk-mini-app .bottom-nav {
        position: fixed !important;
        left: 50% !important;
        right: auto !important;
        bottom: 0 !important;
        transform: translateX(-50%) !important;
        width: min(100%, 480px) !important;
        z-index: 1000 !important;
        padding-bottom: calc(8px + env(safe-area-inset-bottom));
      }
      html.vk-mini-app #consentModal.open { display: grid !important; z-index: 3000 !important; }
    `;
    document.head.appendChild(style);

    syncVisualViewport();
    window.visualViewport?.addEventListener('resize', syncVisualViewport);
    window.visualViewport?.addEventListener('scroll', syncVisualViewport);
    window.addEventListener('resize', syncVisualViewport);
    applyVkLabels();
    void profileReady.catch(() => {});

    document.addEventListener('click', (event) => {
      const button = event.target?.closest?.('#acceptTerms');
      if (button) consentExplicit = true;
    }, true);

  });

  window.addEventListener('pivnik:vk-scanner-error', () => {
    const manualButton = document.getElementById('manualCodeButton');
    if (manualButton && bridgeInitialized) manualButton.click();
  });
})();
