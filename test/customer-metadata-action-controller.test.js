import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerMetadataActionController } from '../customer-metadata-action-controller.js';

function adapterSpy() {
  const calls = [];
  const adapter = {};
  for (const kind of ['addNote', 'addTag', 'removeTag', 'addSegment', 'removeSegment']) {
    adapter[kind] = async (input) => {
      calls.push({ kind, input });
      return { eventId: '9007199254740993', eventType: kind, value: input.note || input.tag || input.segment };
    };
  }
  return { adapter, calls };
}

test('requires explicit confirmation before generating idempotency key or mutating', async () => {
  const { adapter, calls } = adapterSpy();
  let keys = 0;
  const controller = createCustomerMetadataActionController({
    adapter,
    confirmAction: async () => false,
    createRequestKey: () => { keys += 1; return 'request-1'; }
  });

  const result = await controller.addTag({ tag: 'VIP', reason: 'Проверка сегментации' });
  assert.deepEqual(result, { ok: false, reason: 'cancelled' });
  assert.equal(keys, 0);
  assert.equal(calls.length, 0);
});

test('passes reason and a fresh request key only after confirmation', async () => {
  const { adapter, calls } = adapterSpy();
  const confirmations = [];
  const controller = createCustomerMetadataActionController({
    adapter,
    confirmAction: async (summary) => { confirmations.push(summary); return true; },
    createRequestKey: () => 'request-42'
  });

  const result = await controller.addNote({ note: '  Позвонил клиенту  ', reason: '  CRM follow-up  ' });
  assert.equal(result.ok, true);
  assert.equal(confirmations[0].value, 'Позвонил клиенту');
  assert.equal(confirmations[0].reason, 'CRM follow-up');
  assert.deepEqual(calls, [{
    kind: 'addNote',
    input: { note: 'Позвонил клиенту', reason: 'CRM follow-up', requestKey: 'request-42' }
  }]);
});

test('suppresses duplicate submit while mutation is pending', async () => {
  let release;
  const pendingMutation = new Promise((resolve) => { release = resolve; });
  let mutations = 0;
  const adapter = {
    addTag: async () => { mutations += 1; return pendingMutation; }
  };
  const controller = createCustomerMetadataActionController({
    adapter,
    confirmAction: async () => true,
    createRequestKey: () => 'request-duplicate'
  });

  const first = controller.addTag({ tag: 'VIP', reason: 'Ручная классификация' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.pending, true);
  const second = await controller.addTag({ tag: 'VIP', reason: 'Ручная классификация' });
  assert.deepEqual(second, { ok: false, reason: 'already_pending' });
  assert.equal(mutations, 1);
  release({ eventId: '1' });
  await first;
  assert.equal(controller.pending, false);
});

test('refresh callback runs only after a successful mutation', async () => {
  const { adapter } = adapterSpy();
  let refreshed = 0;
  const controller = createCustomerMetadataActionController({
    adapter,
    confirmAction: async () => true,
    createRequestKey: () => 'request-refresh',
    onChanged: async () => { refreshed += 1; }
  });

  await controller.addSegment({ segment: 'returning', reason: 'Подтверждено владельцем' });
  assert.equal(refreshed, 1);
});

test('dispose prevents later mutations and suppresses post-success refresh', async () => {
  let release;
  const adapter = {
    removeTag: async () => new Promise((resolve) => { release = resolve; })
  };
  let refreshed = 0;
  const controller = createCustomerMetadataActionController({
    adapter,
    confirmAction: async () => true,
    createRequestKey: () => 'request-dispose',
    onChanged: async () => { refreshed += 1; }
  });

  const request = controller.removeTag({ tag: 'VIP', reason: 'Больше не соответствует' });
  await new Promise((resolve) => setImmediate(resolve));
  controller.dispose();
  release({ eventId: '2' });
  await request;
  assert.equal(refreshed, 0);
  await assert.rejects(
    () => controller.addTag({ tag: 'new', reason: 'test' }),
    /disposed/
  );
});

test('validation fails before confirmation and network mutation', async () => {
  const { adapter, calls } = adapterSpy();
  let confirmations = 0;
  const controller = createCustomerMetadataActionController({
    adapter,
    confirmAction: async () => { confirmations += 1; return true; },
    createRequestKey: () => 'request-validation'
  });

  await assert.rejects(() => controller.addTag({ tag: ' ', reason: 'reason' }), /tag is required/);
  await assert.rejects(() => controller.addTag({ tag: 'VIP', reason: ' ' }), /reason is required/);
  assert.equal(confirmations, 0);
  assert.equal(calls.length, 0);
});
