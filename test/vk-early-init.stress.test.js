import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'vk-early-init-stress-session-secret';

function inlineScripts(html) {
  return [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]);
}

function runtimeFor(kind) {
  const calls = [];
  const parent = {
    postMessage(message, targetOrigin) {
      calls.push({ channel: 'web', message, targetOrigin });
    }
  };
  const window = {
    addEventListener() {},
    parent
  };

  if (kind === 'android') {
    window.AndroidBridge = {
      VKWebAppInit(payload) {
        calls.push({ channel: 'android', payload: JSON.parse(payload) });
      }
    };
  }

  if (kind === 'ios') {
    window.webkit = {
      messageHandlers: {
        VKWebAppClose: { postMessage() {} },
        VKWebAppInit: {
          postMessage(payload) {
            calls.push({ channel: 'ios', payload });
          }
        }
      }
    };
  }

  if (kind === 'react-native') {
    window.ReactNativeWebView = {
      postMessage(payload) {
        calls.push({ channel: 'react-native', payload: JSON.parse(payload) });
      }
    };
  }

  return {
    calls,
    context: {
      Date,
      JSON,
      Math,
      Promise,
      URLSearchParams,
      document: { addEventListener() {} },
      location: { search: '' },
      navigator: { userAgent: kind === 'react-native' ? 'Android' : 'VK test' },
      parent,
      window
    }
  };
}

test('500 последовательных запусков отправляют VKWebAppInit из первого HTML', async () => {
  const { renderAppIndex } = await import('../universal-server.js?vk-early-init-stress');
  const nonce = 'vk-stress-test-nonce';
  const html = await renderAppIndex('vk', nonce);
  const scripts = inlineScripts(html);

  assert.equal(scripts.length, 1);
  assert.ok(
    html.indexOf('__PIVNIK_EARLY_VK_INIT_PROMISE__') < html.indexOf('/vk-platform.js'),
    'VKWebAppInit must run before deferred application scripts'
  );

  const kinds = ['web', 'android', 'ios', 'react-native'];
  for (let run = 0; run < 500; run += 1) {
    const kind = kinds[run % kinds.length];
    const { calls, context } = runtimeFor(kind);
    vm.runInNewContext(scripts[0], context);

    assert.equal(calls.length, 1, `run ${run + 1}: one Init call expected`);
    const call = calls[0];
    if (kind === 'web') {
      assert.equal(call.channel, 'web');
      assert.equal(call.message?.handler, 'VKWebAppInit');
      assert.equal(call.message?.type, 'vk-connect');
      assert.equal(call.targetOrigin, '*');
    } else if (kind === 'react-native') {
      assert.equal(call.channel, 'react-native');
      assert.equal(call.payload?.handler, 'VKWebAppInit');
    } else {
      assert.equal(call.channel, kind);
      assert.ok(call.payload?.request_id);
    }
    assert.ok(context.window.__PIVNIK_EARLY_VK_INIT_AT__ > 0);
    assert.equal(
      typeof context.window.__PIVNIK_EARLY_VK_INIT_PROMISE__?.then,
      'function'
    );
  }
});
