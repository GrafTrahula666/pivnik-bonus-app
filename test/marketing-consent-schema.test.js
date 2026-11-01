import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql = fs.readFileSync(new URL('../ops/sql/CHAT13-121-marketing-consent-manual.sql', import.meta.url), 'utf8');

test('manual DDL is isolated from automatic migration runners and has no data writes', () => {
  assert.match(sql, /MANUAL \/ UNMOUNTED \/ NOT FOR PRODUCTION/);
  assert.match(sql, /Dedicated SPACEVERSE tenant CRM database only/);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+users\b|\bUPDATE\s+users\b|\bDELETE\s+FROM\b|\bDROP\s+TABLE\b/i);
});

test('consent evidence requires exact ownership and channel-specific grant proof', () => {
  assert.match(sql, /REFERENCES spaceverse_customer_ownership \(user_id, runtime_key, company_id, venue_id\)/);
  assert.match(sql, /channel TEXT NOT NULL CHECK \(channel IN \('telegram','vk'\)\)/);
  assert.match(sql, /purpose TEXT NOT NULL CHECK \(purpose = 'marketing'\)/);
  assert.match(sql, /authenticated_actor_user_id = user_id/);
  assert.match(sql, /consent_text_sha256 ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(sql, /action TEXT NOT NULL CHECK \(action IN \('grant','revoke'\)\)/);
});

test('scoped idempotency, exact latest pointer, and immutable evidence', () => {
  assert.match(sql, /UNIQUE \(user_id, runtime_key, company_id, venue_id, channel, purpose, idempotency_key\)/);
  assert.match(sql, /PRIMARY KEY \(user_id, runtime_key, company_id, venue_id, channel, purpose\)/);
  assert.match(sql, /FOREIGN KEY \(latest_event_id, user_id, runtime_key, company_id, venue_id, channel, purpose\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON spaceverse_marketing_consent_events/);
  assert.doesNotMatch(sql, /\bGRANT\s+(?:ALL|INSERT|SELECT|UPDATE|DELETE)\b/i);
});
