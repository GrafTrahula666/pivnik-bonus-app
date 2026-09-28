import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOOTSTRAP_TOKEN_PREFIX,
  DEVICE_TOKEN_PREFIX,
  createBootstrapToken,
  createDeviceToken,
  createPairCode,
  hashDeviceSecret,
  normalizeDeviceLabel,
  normalizePairCode,
  parseDeviceAuthorization
} from '../device-auth-core.js';

test('pairing code normalization is strict and human friendly', () => {
  assert.equal(normalizePairCode('bar-abcd-2345'), 'BAR-ABCD-2345');
  assert.equal(normalizePairCode('ABCD2345'), 'BAR-ABCD-2345');
  assert.equal(normalizePairCode('BAR-OOOO-1111'), '');
  assert.equal(normalizePairCode('short'), '');
});

test('pairing code generator avoids ambiguous alphabet', () => {
  const code = createPairCode((_min, max) => max - 1);
  assert.match(code, /^BAR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(code.includes('O'), false);
  assert.equal(code.includes('I'), false);
  assert.equal(code.includes('1'), false);
  assert.equal(code.includes('0'), false);
});

test('opaque device and bootstrap tokens are namespaced', () => {
  const deterministic = () => Buffer.alloc(32, 7);
  assert.ok(createDeviceToken(deterministic).startsWith(DEVICE_TOKEN_PREFIX));
  assert.ok(createBootstrapToken(deterministic).startsWith(BOOTSTRAP_TOKEN_PREFIX));
});

test('device secret hash is peppered and deterministic', () => {
  const first = hashDeviceSecret('secret', 'pepper-a');
  assert.equal(first, hashDeviceSecret('secret', 'pepper-a'));
  assert.notEqual(first, hashDeviceSecret('secret', 'pepper-b'));
  assert.notEqual(first, hashDeviceSecret('another', 'pepper-a'));
});

test('device authorization only accepts Device scheme and token prefix', () => {
  const token = `${DEVICE_TOKEN_PREFIX}${'a'.repeat(48)}`;
  assert.equal(parseDeviceAuthorization(`Device ${token}`), token);
  assert.equal(parseDeviceAuthorization(`Bearer ${token}`), '');
  assert.equal(parseDeviceAuthorization('Device bad'), '');
});

test('device labels are normalized and bounded', () => {
  assert.equal(normalizeDeviceLabel('  Бар   № 1  '), 'Бар № 1');
  assert.equal(normalizeDeviceLabel(''), 'Барный терминал');
  assert.equal(normalizeDeviceLabel('x'.repeat(200)).length, 80);
});
