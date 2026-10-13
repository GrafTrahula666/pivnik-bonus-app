import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function wheelDurationLabel('), app.indexOf('function startWheelCountdown('));

function harness() {
  let now = Date.parse('2026-09-26T00:00:00Z');
  const elements = new Map();
  const state = { profile: { balance: 100 }, wheel: { status: null, busy: false } };
  let pending = false;
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    state, Date: Clock, fmt: String, pendingWheelRequest: () => pending,
    $: (selector) => {
      if (!elements.has(selector)) elements.set(selector, { textContent: '' });
      return elements.get(selector);
    }
  });
  vm.runInContext(source, context);
  return {
    state, elements,
    advance(ms) { now += ms; },
    pending(value) { pending = value; },
    cooldown() {
      state.wheel.status = { freeAvailable: false, nextFreeAt: new Date(now + 86400000).toISOString(), canAffordPaid: false, balance: 0 };
    },
    render() {
      vm.runInContext('renderWheelStatus()', context);
      return elements.get('#homeWheelStatus').textContent;
    }
  };
}

test('home countdown runs from 24 hours to one second and becomes only Доступно at expiry', () => {
  const h = harness();
  h.cooldown();
  assert.equal(h.render(), '24:00:00');
  h.advance(1000);
  assert.equal(h.render(), '23:59:59');
  h.advance(86398000);
  assert.equal(h.render(), '00:00:01');
  h.advance(1000);
  assert.equal(h.render(), 'Доступно');
  assert.equal(h.elements.get('#wheelSpinButton').disabled, false);
  assert.equal(h.state.wheel.status.freeAvailable, false, 'display must not overwrite server state');
});

test('unknown availability does not advertise a free spin', () => {
  const h = harness();
  h.state.wheel.status = { freeAvailable: true };
  assert.equal(h.render(), 'Доступно');
  h.state.wheel.status = null;
  assert.equal(h.render(), '');
  assert.equal(h.elements.get('#wheelSpinButton').disabled, true);
});

test('pending result keeps recovery in the wheel screen and compact countdown on home', () => {
  const h = harness();
  h.cooldown();
  h.pending(true);
  assert.equal(h.render(), '24:00:00');
  assert.equal(h.elements.get('#wheelSpinButton').textContent, 'Проверить результат');
  h.advance(86400000);
  assert.equal(h.render(), '');
  h.pending(false);
  assert.equal(h.render(), 'Доступно');
});
