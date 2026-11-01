import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateMarketingConsent, MARKETING_CHANNELS } from '../marketing-consent-policy.js';

const tenantId = 'tenant_A';
const customerId = '42';
const providerIdentityId = 'identity_tg_42';
const consentTextVersion = 'marketing_tg_v1';

const good = Object.freeze({
  eventId: 'event1', tenantId, customerId, channel: 'telegram',
  purpose: 'marketing', action: 'grant', providerIdentityId,
  consentTextVersion, sourceSurface: 'telegram_mini_app',
  authenticatedActorId: customerId, explicitOptIn: true,
  requestId: 'request123', idempotencyKey: 'request123',
  serverRecordedAt: '2026-11-01T00:00:00.000Z'
});
const ctx = Object.freeze({ tenantId, customerId, channel: 'telegram', providerIdentityId, consentTextVersion });
const decision = (latestEvent, overrides = {}) =>
  evaluateMarketingConsent({ ...ctx, latestEvent, ...overrides });

// This is deliberately NOT a test of the existing legacy broadcast path.
test('approved channels are separate, never the synthetic all channel', () => {
  assert.deepEqual(MARKETING_CHANNELS, ['telegram', 'vk']);
  assert.equal(decision(good, { channel: 'all' }).reason, 'channel_invalid');
  assert.equal(decision(good, { channel: 'email' }).allowed, false);
});

test('explicit Telegram grant with exact server-side proof allows Telegram only', () => {
  assert.deepEqual(decision(good), { allowed: true, reason: 'consent_proven' });
  assert.equal(decision(good, { channel: 'vk', providerIdentityId: 'identity_vk_42' }).allowed, false);
});

test('standalone valid VK grant does not grant Telegram', () => {
  const vk = { ...good, channel: 'vk', providerIdentityId: 'identity_vk_42',
    consentTextVersion: 'marketing_vk_v1', sourceSurface: 'vk_mini_app' };
  assert.equal(decision(vk, { channel: 'vk', providerIdentityId: 'identity_vk_42', consentTextVersion: 'marketing_vk_v1' }).allowed, true);
  assert.equal(decision(vk).allowed, false);
});

test('no event or malformed evidence fails closed', () => {
  for (const input of [null, undefined, false, 1, 'yes', [], {}]) {
    assert.equal(decision(input).allowed, false);
  }
});

test('general terms or absence of opt-out is not marketing grant', () => {
  assert.equal(decision({ ...good, action: 'terms_accepted' }).allowed, false);
  assert.equal(decision({ ...good, explicitOptIn: false }).allowed, false);
  assert.equal(decision({ ...good, explicitOptIn: undefined }).allowed, false);
});

test('revoke denies even when previous consent existed (caller supplies newest event)', () => {
  assert.equal(decision({ ...good, action: 'revoke', explicitOptIn: false }).reason, 'consent_revoked');
  assert.equal(decision(good).allowed, true);
});

test('tenant/customer/channel/purpose substitution cannot approve consent', () => {
  for (const patch of [{ tenantId: 'tenant_B' }, { customerId: '43' },
    { channel: 'vk' }, { purpose: 'transactional' }]) {
    assert.equal(decision({ ...good, ...patch }).reason, 'evidence_scope_mismatch');
  }
  assert.equal(decision(good, { tenantId: 'tenant_B' }).allowed, false);
  assert.equal(decision(good, { customerId: '43' }).allowed, false);
});

test('identity rotation and obsolete copy version deny future sends', () => {
  assert.equal(decision(good, { providerIdentityId: 'identity_tg_NEW' }).reason, 'identity_changed');
  assert.equal(decision(good, { consentTextVersion: 'marketing_tg_v2' }).reason, 'consent_text_outdated');
});

test('an authenticated actor must be the consenting client', () => {
  assert.equal(decision({ ...good, authenticatedActorId: 'admin1' }).reason, 'consent_not_proven');
});

test('server-verified channel surface is required for grant', () => {
  assert.equal(decision({ ...good, sourceSurface: 'vk_mini_app' }).allowed, false);
  assert.equal(decision({ ...good, sourceSurface: undefined }).allowed, false);
});

test('durable audit identifiers and server time are required', () => {
  for (const patch of [
    { eventId: null }, { requestId: '' }, { idempotencyKey: undefined },
    { serverRecordedAt: 'yesterday' }, { serverRecordedAt: undefined },
    { authenticatedActorId: null }
  ]) assert.equal(decision({ ...good, ...patch }).reason, 'evidence_invalid');
});

test('invalid caller scope/identity/configuration fails closed', () => {
  for (const p of [
    { tenantId: '' }, { tenantId: 'tenant A' }, { customerId: undefined },
    { providerIdentityId: null }, { consentTextVersion: null }
  ]) assert.equal(decision(good, p).allowed, false);
});

test('unknown actions and inconsistent claims deny', () => {
  assert.equal(decision({ ...good, action: 'unknown' }).allowed, false);
  assert.equal(decision({ ...good, purpose: 'marketing_and_service' }).allowed, false);
  assert.equal(decision({ ...good, consentTextVersion: null }).allowed, false);
});

test('does not mutate callers or events', () => {
  const before = JSON.stringify(good);
  const result = decision(good);
  assert.equal(JSON.stringify(good), before);
  assert.equal(Object.isFrozen(result), true);
});
