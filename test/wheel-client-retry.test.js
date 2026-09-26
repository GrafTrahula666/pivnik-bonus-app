import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const start = app.includes('function wheelPrizeDisplayTitle(')
  ? app.indexOf('function wheelPrizeDisplayTitle(')
  : app.includes('function pendingWheelRequest()')
    ? app.indexOf('function pendingWheelRequest()') : app.indexOf('async function spinWheel()');
const source = app.slice(start, app.indexOf('function openWheel()', start));
let sequence = 0;
const result = {
  spin: { prize: { code: 'bonus-5', title: '5 бонусов' } },
  status: { freeAvailable: false, canAffordPaid: false, balance: 5, nextPaidCost: 50 },
  account: { balance: 5, unlimitedBonus: false, giftBeerLiters: 0 }
};

function harness({ vk = false, storage = new Map(), userId = '42', status, api, loadStatus } = {}) {
  const elements = new Map();
  const state = {
    profile: { id: userId, balance: 100, termsAccepted: true },
    wheel: { busy: false, rotation: 0, status: status === undefined ? { freeAvailable: true, canAffordPaid: true } : status }
  };
  const toasts = [];
  const context = vm.createContext({
    state, IS_VK: vk, JSON, TypeError,
    safeStorage: {
      get: (key) => storage.get(key) || '', set: (key, value) => storage.set(key, value), remove: (key) => storage.delete(key)
    },
    $: (selector) => {
      if (!elements.has(selector)) elements.set(selector, { classList: { add() {}, remove() {} }, style: {}, setAttribute() {} });
      return elements.get(selector);
    },
    requestId: () => `wheel-test-request-${++sequence}`,
    effectiveWheelStatus: () => state.wheel.status,
    loadWheelStatus: async () => { if (loadStatus) await loadStatus(state); },
    api: api || (async () => result),
    renderWheelStatus() {}, renderProfile() {}, toast(message) { toasts.push(message); }, haptic() {},
    visualSectorForPrize: () => ({ center: 0 }), waitForWheelStop: async () => {},
    window: { setTimeout() {} }
  });
  vm.runInContext(source, context);
  return { state, storage, elements, toasts, spin: () => vm.runInContext('spinWheel()', context) };
}

for (const vk of [false, true]) {
  const platform = vk ? 'VK' : 'Telegram';
  test(`${platform}: a lost committed spin response replays one request after a manual retry`, async () => {
    const keys = [];
    const ledger = new Set();
    const h = harness({ vk, api: async (_path, options) => {
      const key = JSON.parse(options.body).requestKey;
      keys.push(key); ledger.add(key);
      if (keys.length === 1) throw Object.assign(new Error('response lost'), { code: 'TIMEOUT' });
      return result;
    } });
    await h.spin();
    await h.spin();
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(ledger.size, 1, 'retry must not create a second paid operation');
  });

  test(`${platform}: reload can recover a pending spin even when the remaining balance cannot pay again`, async () => {
    const storage = new Map();
    let firstKey;
    const before = harness({ vk, storage, api: async (_path, options) => {
      firstKey = JSON.parse(options.body).requestKey;
      throw new TypeError('network lost after commit');
    } });
    await before.spin();
    const keys = [];
    const after = harness({ vk, storage, status: result.status, api: async (_path, options) => {
      keys.push(JSON.parse(options.body).requestKey); return result;
    } });
    await after.spin();
    assert.deepEqual(keys, [firstKey]);
    assert.equal(storage.size, 0, 'confirmed outcome clears the pending request');
  });

  test(`${platform}: rapid clicks while wheel status loads send only one spin`, async () => {
    let resolveStatus;
    const statusReady = new Promise((resolve) => { resolveStatus = resolve; });
    let calls = 0;
    const h = harness({ vk, status: null,
      loadStatus: async (state) => { await statusReady; state.wheel.status = { freeAvailable: true }; },
      api: async () => { calls++; return result; }
    });
    const first = h.spin(); const second = h.spin();
    resolveStatus();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(h.state.wheel.busy, false);
  });
}

test('a definitive insufficient-balance rejection releases its key for a later new spin', async () => {
  const keys = [];
  const h = harness({ api: async (_path, options) => {
    keys.push(JSON.parse(options.body).requestKey);
    if (keys.length === 1) throw Object.assign(new Error('insufficient balance'), { status: 409 });
    return result;
  } });
  await h.spin(); await h.spin();
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(h.storage.size, 0);
});

test('an unconfirmed result survives auth failure but never crosses user identity', async () => {
  const storage = new Map();
  const keys = [];
  const failed = harness({ storage, api: async (_path, options) => {
    keys.push(JSON.parse(options.body).requestKey);
    throw Object.assign(new Error('session expired'), { status: 401 });
  } });
  await failed.spin(); await failed.spin();
  assert.equal(keys[0], keys[1]);
  const other = harness({ storage, userId: '99', api: async (_path, options) => {
    keys.push(JSON.parse(options.body).requestKey); return result;
  } });
  await other.spin();
  assert.notEqual(keys[0], keys[2]);
});

test('failed status loading unlocks the wheel without reserving a mutation key', async () => {
  const h = harness({ status: null, loadStatus: async () => { throw new TypeError('offline'); } });
  await h.spin().catch(() => {});
  assert.equal(h.state.wheel.busy, false);
  assert.equal(h.storage.size, 0);
});


test('wheel renders a trusted Russian prize title instead of server-supplied garbage', async () => {
  const h = harness({ api: async () => ({
    ...result,
    spin: { prize: { code: 'bonus-20', title: '<script>JAWA{}[]\\u0000%%%' } }
  }) });
  await h.spin();
  assert.equal(h.elements.get('#wheelResultKicker').textContent, 'Ваш приз');
  assert.equal(h.elements.get('#wheelResultTitle').textContent, '20 бонусов');
});

test('wheel errors never expose raw technical text to the user', async () => {
  const h = harness({ api: async () => {
    throw Object.assign(new Error('SyntaxError: Unexpected token < in JSON at position 0 {JAWA}'), { status: 500 });
  } });
  await h.spin();
  assert.equal(h.elements.get('#wheelResultTitle').textContent, 'Не удалось завершить вращение. Попробуйте ещё раз.');
  assert.deepEqual(h.toasts, ['Не удалось завершить вращение. Попробуйте ещё раз.']);
});
