import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('const HALLOWEEN_DRAW_AT ='), app.indexOf('\nconst HALLOWEEN_BANNER ='));
function harness(api) {
  const elements = new Map();
  const toasts = [];
  const context = vm.createContext({
    api, document: { visibilityState: 'visible' }, Date, Number, String,
    setInterval: () => 1, clearInterval: () => {}, IS_VK: false,
    openModal: () => {}, switchScreen: () => {}, toast: (message) => toasts.push(message),
    $: (id) => {
      if (!elements.has(id)) elements.set(id, { textContent: '', hidden: true, disabled: false, value: '' });
      return elements.get(id);
    }
  });
  vm.runInContext(source, context);
  return { elements, toasts, run: (code) => vm.runInContext(code, context) };
}
function summary(overrides = {}) {
  return { available: true, tickets: 1, closesAt: '2026-10-31T17:00:00Z',
    invite: { code: 'ABCD2345', weekCount: 1, weekLimit: 3, pendingCount: 2, qualifiedCount: 4,
      canEnterCode: true, enterUntil: '2026-10-08T17:00:00Z', bonusPerFriend: 100 }, ...overrides };
}
test('loading, missing setup and transport failure never render a zero balance or a shareable fake code; retry recovers', async () => {
  let mode = 'unavailable';
  const h = harness(async () => {
    if (mode === 'error') throw new Error('offline');
    return mode === 'unavailable' ? { available: false, tickets: null, invite: { code: null } } : summary();
  });
  h.run('renderHalloween(null)');
  assert.equal(h.elements.get('#halloweenTickets').textContent, '—');
  await h.run('openHalloweenPage()');
  assert.equal(h.elements.get('#halloweenTickets').textContent, '—');
  assert.equal(h.elements.get('#halloweenShareCode').disabled, true);
  assert.equal(h.elements.get('#halloweenEnterBlock').hidden, false);
  mode = 'ready'; await h.run('refreshHalloweenSummary()');
  assert.equal(h.elements.get('#halloweenTickets').textContent, '1');
  assert.equal(h.elements.get('#halloweenInviteCount').textContent, '1/3');
  assert.equal(h.elements.get('#halloweenShareCode').disabled, false);
  assert.match(h.elements.get('#halloweenInviteProgress').textContent, /Ждём первую покупку: 2/);
  mode = 'error'; await h.run('refreshHalloweenSummary()');
  assert.equal(h.elements.get('#halloweenTickets').textContent, '—');
  assert.equal(h.elements.get('#halloweenMyCode').textContent, '—');
  assert.equal(h.elements.get('#halloweenApplyCode').disabled, true);
  assert.equal(h.elements.get('#halloweenRetry').hidden, false);
  mode = 'ready'; await h.run('refreshHalloweenSummary()');
  assert.equal(h.elements.get('#halloweenTickets').textContent, '1');
});
test('old accounts still see the entry field with an explanation, while submission is prevented', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return summary({ invite: { canEnterCode: false, entryReason: 'window_expired' } }); });
  await h.run('openHalloweenInvite()');
  assert.equal(h.elements.get('#halloweenEnterBlock').hidden, false);
  assert.equal(h.elements.get('#halloweenCodeInput').disabled, true);
  assert.match(h.elements.get('#halloweenEnterTitle').textContent, /первые сутки/);
  await h.run('applyHalloweenCode()');
  assert.equal(calls, 1);
});
test('paste an invite link, prevent concurrent claims, show server-confirmed attribution and refresh counts', async () => {
  let resolveClaim;
  let claims = 0;
  let applied = false;
  const link = 'https://t.me/pivnik_bot/app?startapp=inv_ABCD2345';
  const h = harness(async (path, options) => {
    if (path.endsWith('/claim')) {
      claims++; assert.equal(JSON.parse(options.body).code, link);
      return await new Promise((resolve) => { resolveClaim = () => { applied = true; resolve({ attached: true }); }; });
    }
    return summary(applied ? { invite: { invitedBy: true, canEnterCode: false, entryReason: 'already_attached' } } : {});
  });
  await h.run('refreshHalloweenSummary()');
  h.elements.get('#halloweenCodeInput').value = link;
  const request = h.run('applyHalloweenCode()');
  assert.equal(h.elements.get('#halloweenApplyCode').disabled, true);
  await h.run('refreshHalloweenSummary()');
  assert.equal(h.elements.get('#halloweenApplyCode').disabled, true);
  await h.run('applyHalloweenCode()'); assert.equal(claims, 1);
  resolveClaim(); await request;
  assert.equal(h.elements.get('#halloweenInvitedNote').hidden, false);
  assert.equal(h.elements.get('#halloweenApplyCode').disabled, true);
  assert.match(h.toasts[0], /100 бонусов/);
});
