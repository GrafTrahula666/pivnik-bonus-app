(() => {
  'use strict';

  window.__PIVNIK_PLATFORM__ = 'vk';

  let settled = false;
  let initSent = false;
  let resolveInit;
  window.__PIVNIK_VK_INIT_PROMISE__ = new Promise((resolve) => {
    resolveInit = resolve;
  });

  function settle(value) {
    if (settled) return;
    settled = true;
    resolveInit(Boolean(value));
  }

  function sendNativeInit() {
    if (initSent) return true;

    try {
      const iosHandler = window.webkit?.messageHandlers?.VKWebAppInit;
      if (iosHandler && typeof iosHandler.postMessage === 'function') {
        initSent = true;
        iosHandler.postMessage({});
        settle(true);
        return true;
      }
    } catch (error) {
      console.warn('Direct iOS VKWebAppInit failed:', error);
    }

    try {
      const androidHandler = window.AndroidBridge?.VKWebAppInit;
      if (typeof androidHandler === 'function') {
        initSent = true;
        androidHandler(JSON.stringify({}));
        settle(true);
        return true;
      }
    } catch (error) {
      console.warn('Direct Android VKWebAppInit failed:', error);
    }

    try {
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        initSent = true;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          handler: 'VKWebAppInit',
          params: {}
        }));
        settle(true);
        return true;
      }
    } catch (error) {
      console.warn('Direct React Native VKWebAppInit failed:', error);
    }

    return false;
  }

  function sendBridgeInit() {
    if (initSent) return true;
    const bridge = window.vkBridge;
    if (!bridge?.send) return false;

    initSent = true;
    try {
      Promise.resolve(bridge.send('VKWebAppInit', {}))
        .then(() => settle(true))
        .catch((error) => {
          console.warn('Early VKWebAppInit acknowledgement unavailable:', error);
          settle(false);
        });
      return true;
    } catch (error) {
      console.warn('Early VKWebAppInit failed to start:', error);
      settle(false);
      return true;
    }
  }

  // VK iOS can keep its own Mini Apps loader above the page until it receives
  // VKWebAppInit. Send directly to the native handler before waiting for the
  // external bridge bundle, then fall back to vkBridge for web/desktop shells.
  if (sendNativeInit() || sendBridgeInit()) return;

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (sendNativeInit() || sendBridgeInit()) {
      window.clearInterval(timer);
      return;
    }
    if (attempts >= 40) {
      window.clearInterval(timer);
      console.error('VK Bridge/native init channel is unavailable during early initialization.');
      settle(false);
    }
  }, 25);
})();
