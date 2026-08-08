(() => {
  'use strict';

  const bridge = window.vkBridge;
  const originalFetch = window.fetch.bind(window);
  const launchParams = window.location.search.replace(/^\?/, '');
  let vkUser = null;
  let bridgeInitialized = false;

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
    return vkUser;
  })();

  function sendBridge(method, params) {
    if (!bridge?.send) return Promise.reject(new Error('VK Bridge unavailable'));
    return bridgeReady.then(() => bridge.send(method, params));
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
          const code = String(data?.code_data || data?.code || '').trim();
          if (code) return callback?.(code);
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
  document.documentElement.classList.add('vk-mini-app');

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
      return originalFetch(input, {
        ...init,
        headers,
        body: JSON.stringify({
          platform: 'vk',
          launchParams,
          user: vkUser
        })
      });
    }
    return originalFetch(input, init);
  };

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
        .replace(/Telegram/g, 'VK')
        .replace(/телеграм/gi, 'VK');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    replacePlatformWords(document.body);
    const eyebrow = document.getElementById('eyebrow');
    if (eyebrow) eyebrow.textContent = 'VK Mini App';
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
