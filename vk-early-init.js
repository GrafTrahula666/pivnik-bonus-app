(() => {
  'use strict';

  const bridge = window.vkBridge;
  if (!bridge?.send) {
    console.error('VK Bridge is unavailable during early initialization.');
    window.__PIVNIK_VK_INIT_PROMISE__ = Promise.resolve(false);
    return;
  }

  try {
    window.__PIVNIK_VK_INIT_PROMISE__ = Promise.resolve(
      bridge.send('VKWebAppInit', {})
    )
      .then(() => true)
      .catch((error) => {
        console.warn('Early VKWebAppInit acknowledgement unavailable:', error);
        return false;
      });
  } catch (error) {
    console.warn('Early VKWebAppInit failed to start:', error);
    window.__PIVNIK_VK_INIT_PROMISE__ = Promise.resolve(false);
  }
})();
