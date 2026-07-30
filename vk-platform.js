(() => {
  'use strict';

  const bridge = window.vkBridge;
  const originalFetch = window.fetch.bind(window);
  const launchParams = window.location.search.replace(/^\?/, '');
  const launchSearch = new URLSearchParams(launchParams);
  const launchVkUserId = String(launchSearch.get('vk_user_id') || '').trim();
  let vkUser = null;
  let bridgeInitialized = false;
  let consentExplicit = false;
  let consentRequired = false;
  let consentObserver = null;

  /*
   * Telegram and VK must never share a browser session. VK is also
   * re-authenticated on every launch so switching VK accounts cannot reuse
   * another person's profile, role or QR code.
   */
  const storageKeys = new Set(['pivnik_session', 'pivnik_staff_session']);
  const storagePrefix = `pivnik_vk_${launchVkUserId || 'unknown'}_`;
  const storageProto = window.Storage?.prototype;
  if (storageProto) {
    const getItem = storageProto.getItem;
    const setItem = storageProto.setItem;
    const removeItem = storageProto.removeItem;
    const mappedKey = (storage, key) => (
      storage === window.localStorage && storageKeys.has(String(key))
        ? `${storagePrefix}${String(key)}`
        : String(key)
    );

    storageProto.getItem = function patchedGetItem(key) {
      return getItem.call(this, mappedKey(this, key));
    };
    storageProto.setItem = function patchedSetItem(key, value) {
      return setItem.call(this, mappedKey(this, key), value);
    };
    storageProto.removeItem = function patchedRemoveItem(key) {
      return removeItem.call(this, mappedKey(this, key));
    };

    try {
      removeItem.call(window.localStorage, 'pivnik_session');
      removeItem.call(window.localStorage, 'pivnik_staff_session');
      removeItem.call(window.localStorage, `${storagePrefix}pivnik_session`);
      removeItem.call(window.localStorage, `${storagePrefix}pivnik_staff_session`);
    } catch (_) {}
  }

  const bridgeReady = (async () => {
    if (!bridge?.send) throw new Error('VK Bridge не загрузился.');
    await bridge.send('VKWebAppInit');
    bridgeInitialized = true;
    try {
      vkUser = await bridge.send('VKWebAppGetUserInfo');
    } catch (error) {
      console.warn('VK user info unavailable:', error);
      vkUser = null;
    }
    if (vkUser?.id && launchVkUserId && String(vkUser.id) !== launchVkUserId) {
      throw new Error('Аккаунт VK не совпадает с подписанными параметрами запуска.');
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
      await bridgeReady;
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

  function replacePlatformWords(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const value = node.nodeValue || '';
      if (!/Telegram|телеграм/i.test(value)) return;
      node.nodeValue = value
        .replace(/Telegram Mini App/g, 'VK Mini App')
        .replace(/Telegram ID/g, 'VK ID')
        .replace(/Telegram/g, 'VK')
        .replace(/телеграм/gi, 'VK');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.id = 'vk-layout-hardening';
    style.textContent = `
      html.vk-mini-app, html.vk-mini-app body { height: 100%; overflow: hidden !important; }
      html.vk-mini-app .app-shell {
        height: 100dvh !important;
        min-height: 100dvh !important;
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

    replacePlatformWords(document.body);
    const eyebrow = document.getElementById('eyebrow');
    if (eyebrow) eyebrow.textContent = 'VK Mini App';

    document.addEventListener('click', (event) => {
      const button = event.target?.closest?.('#acceptTerms');
      if (button) consentExplicit = true;
    }, true);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') replacePlatformWords(mutation.target.parentNode);
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) replacePlatformWords(node.parentNode);
          else if (node.nodeType === Node.ELEMENT_NODE) replacePlatformWords(node);
        });
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  window.addEventListener('pivnik:vk-scanner-error', () => {
    const manualButton = document.getElementById('manualCodeButton');
    if (manualButton && bridgeInitialized) manualButton.click();
  });
})();
