(() => {
  'use strict';

  const bridge = window.vkBridge;
  const originalFetch = window.fetch.bind(window);
  const diagnostics = (() => {
    const bytes = new Uint8Array(12);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const started = Date.now();
    let attempt = 0;
    let pending = [];
    let timer = 0;
    let lastStage = 'VK_BOOT_START';
    let sent = 0;
    const allowed = new Set([
      'VK_BOOT_START', 'VK_PLATFORM_READY', 'VK_BRIDGE_AVAILABLE', 'VK_BRIDGE_UNAVAILABLE',
      'VK_BRIDGE_INIT_START', 'VK_BRIDGE_INIT_OK', 'VK_BRIDGE_INIT_TIMEOUT', 'VK_BRIDGE_INIT_FAIL',
      'VK_LAUNCH_PARAMS_URL_PRESENT', 'VK_LAUNCH_PARAMS_BRIDGE_PRESENT', 'VK_LAUNCH_PARAMS_MISSING',
      'VK_AUTH_START', 'VK_AUTH_STATUS', 'VK_AUTH_SUCCESS', 'VK_AUTH_FAIL', 'VK_SESSION_RECEIVED',
      'VK_SESSION_REJECTED', 'VK_PROFILE_REQUEST_START', 'VK_PROFILE_SUCCESS', 'VK_PROFILE_FAIL',
      'VK_BOOT_COMPLETE', 'VK_BOOT_FAIL', 'VK_BOOT_STALLED', 'VK_CLIENT_ERROR'
    ]);
    const safeCodes = new Set(['NONE', 'TIMEOUT', 'NETWORK', 'HTTP_401', 'HTTP_403', 'HTTP_429',
      'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_ERROR', 'INVALID_RESPONSE', 'BRIDGE_FAILURE', 'UNKNOWN']);
    function errorCode(error) {
      if (error?.code === 'TIMEOUT' || error?.name === 'AbortError') return 'TIMEOUT';
      const status = Number(error?.status || 0);
      if (status) return safeCodes.has(`HTTP_${status}`) ? `HTTP_${status}` : 'HTTP_ERROR';
      if (safeCodes.has(error?.code)) return error.code;
      return error instanceof TypeError ? 'NETWORK' : 'UNKNOWN';
    }
    function flush() {
      timer = 0;
      if (!pending.length || sent >= 12) return;
      const events = pending.splice(0, 24);
      sent++;
      const controller = typeof AbortController === 'undefined' ? null : new AbortController();
      const deadline = window.setTimeout(() => controller?.abort(), 2000);
      void Promise.resolve().then(() => originalFetch('/api/diagnostics/vk-startup', {
        method: 'POST', credentials: 'omit', keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bootId: id, events }),
        ...(controller ? { signal: controller.signal } : {})
      })).catch(() => {}).finally(() => window.clearTimeout(deadline));
    }
    function emit(event, details = {}) {
      if (!allowed.has(event)) return;
      lastStage = event;
      if (pending.length < 24 && sent < 12) pending.push({
        event, attempt, timestamp: Date.now(), elapsedMs: Date.now() - started,
        status: Number.isInteger(details.status) && details.status >= 0 && details.status < 600 ? details.status : 0,
        code: safeCodes.has(details.code) ? details.code : 'NONE'
      });
      if (!timer && sent < 12) timer = window.setTimeout(flush, 1000);
    }
    return { id, emit, errorCode, get stage() { return lastStage; },
      begin() { attempt++; emit('VK_BOOT_START'); } };
  })();
  window.__PIVNIK_VK_DIAGNOSTICS__ = diagnostics;
  diagnostics.emit('VK_BOOT_START');
  const rawSearchLaunchParams = window.location.search.replace(/^\?/, '');
  const rawHashLaunchParams = (() => {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    const queryIndex = hash.indexOf('?');
    return (queryIndex >= 0 ? hash.slice(queryIndex + 1) : hash).replace(/^\?/, '');
  })();
  const REQUIRED_LAUNCH_PARAMS = ['vk_app_id', 'vk_user_id', 'vk_ts', 'sign'];

  function hasSignedLaunchParams(value) {
    const params = new URLSearchParams(String(value || ''));
    return REQUIRED_LAUNCH_PARAMS.every((key) => Boolean(params.get(key)));
  }

  function serializeLaunchParams(value) {
    if (!value || typeof value !== 'object') return '';
    const params = new URLSearchParams();
    Object.entries(value).forEach(([key, entry]) => {
      if (entry === undefined || entry === null) return;
      params.set(key, String(entry));
    });
    return params.toString();
  }

  let launchParams = [rawSearchLaunchParams, rawHashLaunchParams]
    .find((value) => hasSignedLaunchParams(value))
    || rawSearchLaunchParams
    || rawHashLaunchParams;
  diagnostics.emit(hasSignedLaunchParams(launchParams) ? 'VK_LAUNCH_PARAMS_URL_PRESENT' : 'VK_LAUNCH_PARAMS_MISSING');
  const launchSearch = new URLSearchParams(launchParams);
  let launchVkUserId = String(launchSearch.get('vk_user_id') || '').trim();
  const BRIDGE_INIT_TIMEOUT_MS = 1600;
  const BRIDGE_PROFILE_TIMEOUT_MS = 2200;
  const VK_PROFILE_SYNC_RETRY_DELAYS_MS = [0, 1400, 3600];
  const BRIDGE_LAUNCH_PARAMS_TIMEOUT_MS = 2200;
  let vkUser = null;
  let bridgeInitialized = false;
  let bridgeLaunchParamsPromise = null;
  let consentExplicit = false;
  let consentRequired = false;
  let consentObserver = null;
  let profileSyncScheduled = false;

  /*
   * Telegram and VK never share a browser session. VK sessions are scoped by
   * the signed VK user id, so changing accounts selects another storage key
   * without forcing every returning user through the full auth transaction.
   */
  let storagePrefix = `pivnik_vk_${launchVkUserId || 'unknown'}_`;
  window.__PIVNIK_STORAGE_PREFIX__ = storagePrefix;
  try {
    localStorage.removeItem('pivnik_session');
    localStorage.removeItem('pivnik_staff_session');
    localStorage.removeItem(`${storagePrefix}pivnik_session`);
    localStorage.removeItem(`${storagePrefix}pivnik_staff_session`);
    if (!launchVkUserId) {
      ['session', 'staff_session'].forEach((key) => localStorage.removeItem(`${storagePrefix}${key}`));
    }
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
      diagnostics.emit('VK_BRIDGE_UNAVAILABLE');
      console.warn('VK Bridge unavailable; signed launch authentication will be used.');
      return false;
    }
    try {
      diagnostics.emit('VK_BRIDGE_AVAILABLE');
      diagnostics.emit('VK_BRIDGE_INIT_START');
      bridgeInitialized = true;
      await withTimeout(
        bridge.send('VKWebAppInit'),
        BRIDGE_INIT_TIMEOUT_MS,
        'VK не подтвердил запуск приложения вовремя.'
      );
      diagnostics.emit('VK_BRIDGE_INIT_OK');
      return true;
    } catch (error) {
      diagnostics.emit(error?.message === 'VK не подтвердил запуск приложения вовремя.'
        ? 'VK_BRIDGE_INIT_TIMEOUT' : 'VK_BRIDGE_INIT_FAIL');
      /*
       * The signed launch parameters are sufficient for authentication.
       * Some VK iOS shells send no acknowledgement even though Init was
       * delivered, so an absent acknowledgement must not freeze the app.
       */
      console.warn('VK init acknowledgement unavailable; continuing:', error);
      return false;
    }
  })();

  function getBridgeLaunchParams() {
    if (!bridge?.send) return Promise.resolve('');
    if (!bridgeLaunchParamsPromise) {
      bridgeLaunchParamsPromise = (async () => {
        try {
          const data = await withTimeout(
            bridge.send('VKWebAppGetLaunchParams'),
            BRIDGE_LAUNCH_PARAMS_TIMEOUT_MS,
            'VK не передал параметры запуска вовремя.'
          );
          const query = serializeLaunchParams(data);
          if (!hasSignedLaunchParams(query)) {
            diagnostics.emit('VK_LAUNCH_PARAMS_MISSING');
            console.warn('VK Bridge returned incomplete launch parameters.');
            return '';
          }
          diagnostics.emit('VK_LAUNCH_PARAMS_BRIDGE_PRESENT');
          return query;
        } catch (error) {
          diagnostics.emit('VK_LAUNCH_PARAMS_MISSING', { code: 'BRIDGE_FAILURE' });
          console.warn('VK launch parameters unavailable from Bridge:', error);
          return '';
        }
      })().finally(() => { bridgeLaunchParamsPromise = null; });
    }
    return bridgeLaunchParamsPromise;
  }

  async function resolveLaunchParams(preferBridge = false) {
    if (!preferBridge && hasSignedLaunchParams(launchParams)) return launchParams;
    const bridgeParams = await getBridgeLaunchParams();
    if (bridgeParams) launchParams = bridgeParams;
    return launchParams;
  }

  function userForLaunch(signedLaunchParams) {
    const userId = new URLSearchParams(signedLaunchParams).get('vk_user_id');
    return vkUser?.id && String(vkUser.id) === userId ? vkUser : null;
  }

  function acceptAuthenticatedIdentity(signedLaunchParams) {
    const userId = new URLSearchParams(signedLaunchParams).get('vk_user_id');
    if (!/^\d+$/.test(userId || '')) return;
    launchVkUserId = userId;
    storagePrefix = `pivnik_vk_${userId}_`;
    window.__PIVNIK_STORAGE_PREFIX__ = storagePrefix;
    window.__PIVNIK_VK_USER_ID__ = userId;
    if (vkUser?.id && String(vkUser.id) !== userId) vkUser = null;
  }

  async function requestVkUserInfo() {
    await bridgeReady;
    if (!bridge?.send) return null;
    let lastError = null;
    for (const retryDelay of VK_PROFILE_SYNC_RETRY_DELAYS_MS) {
      if (retryDelay) await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
      try {
        const profile = await withTimeout(
          bridge.send('VKWebAppGetUserInfo'),
          BRIDGE_PROFILE_TIMEOUT_MS,
          'VK не передал данные профиля вовремя.'
        );
        if (profile?.id && launchVkUserId && String(profile.id) !== launchVkUserId) {
          console.warn('VK profile does not match signed launch parameters; profile data ignored.');
          return null;
        }
        if (profile?.id) return profile;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) console.warn('VK user info unavailable after retries:', lastError);
    return null;
  }

  const profileReady = (async () => {
    vkUser = await requestVkUserInfo();
    return vkUser;
  })();

  function scheduleVkProfileSync(signedLaunchParams) {
    if (profileSyncScheduled || !signedLaunchParams) return;
    profileSyncScheduled = true;
    void profileReady.then(async (profile) => {
      if (!profile?.id) return;
      try {
        const syncResponse = await originalFetch('/api/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            platform: 'vk',
            launchParams: signedLaunchParams,
            user: profile
          })
        });
        if (!syncResponse.ok) {
          console.warn('VK profile hydration sync failed:', syncResponse.status);
          return;
        }
        const data = await syncResponse.clone().json().catch(() => null);
        if (!data?.profile) return;
        const hydration = {
          profile: data.profile,
          statuses: data.statuses || [],
          design: data.design || null
        };
        window.__PIVNIK_VK_PROFILE_HYDRATION__ = hydration;
        window.dispatchEvent(new CustomEvent('pivnik:vk-profile-hydrated', { detail: hydration }));
      } catch (error) {
        console.warn('VK profile hydration sync skipped:', error);
      }
    }).catch((error) => {
      console.warn('VK profile hydration unavailable:', error);
    });
  }

  async function refreshVkProfileOnDemand() {
    const signedLaunchParams = await resolveLaunchParams();
    if (!hasSignedLaunchParams(signedLaunchParams)) {
      throw new Error('VK не передал подписанные параметры запуска.');
    }
    const profile = await requestVkUserInfo();
    if (!profile?.id) {
      throw new Error('VK не передал фотографию профиля.');
    }
    vkUser = profile;
    const syncResponse = await originalFetch('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'vk',
        launchParams: signedLaunchParams,
        user: profile
      })
    });
    if (!syncResponse.ok) {
      throw new Error(`Не удалось обновить профиль VK (${syncResponse.status}).`);
    }
    const data = await syncResponse.clone().json().catch(() => null);
    if (!data?.profile) throw new Error('VK вернул пустой профиль.');
    const hydration = {
      profile: data.profile,
      statuses: data.statuses || [],
      design: data.design || null
    };
    window.__PIVNIK_VK_PROFILE_HYDRATION__ = hydration;
    window.dispatchEvent(new CustomEvent('pivnik:vk-profile-hydrated', { detail: hydration }));
    return hydration;
  }

  window.__PIVNIK_VK_REFRESH_PROFILE__ = refreshVkProfileOnDemand;

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
  diagnostics.emit('VK_PLATFORM_READY');

  function updateConsentState(profile) {
    if (!profile || typeof profile !== 'object') return;
    consentRequired = profile.termsAccepted !== true;
    if (consentRequired) scheduleConsentGate();
    else stopConsentGate();
  }

  async function inspectApiResponse(response, { allowOpen = true } = {}) {
    try {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = await response.clone().json();
      if (!data?.profile) return;

      // Anna frame entitlement and consent persistence hotfix 2026-08-06. A returning VK user can receive a transient auth payload
      // before the canonical /api/me profile is hydrated. A transient false
      // must never reopen the terms window after the server already persisted consent.
      if (data.profile.termsAccepted === true) {
        updateConsentState(data.profile);
      } else if (allowOpen) {
        updateConsentState(data.profile);
      }
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
      headers.set('x-pivnik-boot-id', diagnostics.id);
      const sendAuth = (signedLaunchParams) => originalFetch(input, {
        ...init,
        headers,
        body: JSON.stringify({
          platform: 'vk',
          launchParams: signedLaunchParams,
          user: userForLaunch(signedLaunchParams)
        })
      });
      const signedLaunchParams = await resolveLaunchParams();
      diagnostics.emit('VK_AUTH_START');
      const profileIncludedInFirstAuth = Boolean(userForLaunch(signedLaunchParams));
      let acceptedLaunchParams = signedLaunchParams;
      let response = await sendAuth(signedLaunchParams);
      diagnostics.emit('VK_AUTH_STATUS', { status: response.status });
      if (response.status === 401) {
        if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const refreshedLaunchParams = await resolveLaunchParams(true);
        if (refreshedLaunchParams && refreshedLaunchParams !== signedLaunchParams) {
          acceptedLaunchParams = refreshedLaunchParams;
          response = await sendAuth(refreshedLaunchParams);
          diagnostics.emit('VK_AUTH_STATUS', { status: response.status });
        }
      }
      if (response.ok) acceptAuthenticatedIdentity(acceptedLaunchParams);
      diagnostics.emit(response.ok ? 'VK_AUTH_SUCCESS' : 'VK_AUTH_FAIL', { status: response.status });
      if (response.ok && !profileIncludedInFirstAuth) {
        // Signed auth must never wait for VK Bridge. If profile data arrives later,
        // sync only the display metadata in the background using the same signed id.
        scheduleVkProfileSync(acceptedLaunchParams);
      }
      await inspectApiResponse(response, { allowOpen: false });
      return response;
    }

    if (pathname === '/api/me/consent' && !consentExplicit) {
      return Promise.reject(new Error('Согласие можно подтвердить только кнопкой пользователя.'));
    }

    const isProfileRequest = pathname === '/api/me' || pathname === '/api/bootstrap';
    if (isProfileRequest) {
      const headers = new Headers(init.headers || {});
      headers.set('x-pivnik-boot-id', diagnostics.id);
      init = { ...init, headers };
      diagnostics.emit('VK_PROFILE_REQUEST_START');
    }
    const response = await originalFetch(input, init);
    if (isProfileRequest) diagnostics.emit(response.ok ? 'VK_PROFILE_SUCCESS' : 'VK_PROFILE_FAIL', { status: response.status });
    if (pathname === '/api/me' || pathname === '/api/me/consent') {
      try {
        await inspectApiResponse(response, { allowOpen: true });
      } finally {
        if (pathname === '/api/me/consent') consentExplicit = false;
      }
    }
    return response;
  };

  function openConsentGate() {
    if (!consentRequired) return;
    const modal = document.getElementById('consentModal');
    const shell = document.getElementById('appShell');
    if (!modal || shell?.classList.contains('hidden')) return;

    // VK consent gate idempotency hotfix. MutationObserver watches these exact attributes, so writing
    // the same values repeatedly can create an endless microtask loop in VK iOS.
    const alreadyOpen = modal.classList.contains('open')
      && modal.getAttribute('aria-hidden') === 'false'
      && document.body.classList.contains('modal-open');
    if (!alreadyOpen) {
      modal.classList.add('open');
      if (modal.getAttribute('aria-hidden') !== 'false') {
        modal.setAttribute('aria-hidden', 'false');
      }
      document.body.classList.add('modal-open');
    }

    // The app-level consent guard continues to protect every action. The
    // observer is only needed to open the first gate and must not observe its
    // own mutations indefinitely.
    consentObserver?.disconnect();
    consentObserver = null;
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
