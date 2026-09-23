import test from 'node:test';
import assert from 'node:assert/strict';
import { queryRetentionAudiencePreview } from '../retention-audience-preview.js';

function previewPool(row = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row] };
    }
  };
}

test('retention preview accepts only at_risk and sleeping', async () => {
  const pool = previewPool();
  await assert.rejects(() => queryRetentionAudiencePreview(pool, 'active'), /at_risk or sleeping/);
  await assert.rejects(() => queryRetentionAudiencePreview(pool, ''), /at_risk or sleeping/);
  assert.equal(pool.calls.length, 0);
});

test('at_risk preview is read-only, consent gated and channel aware', async () => {
  const pool = previewPool({
    total: 12,
    consented: 8,
    without_consent: 4,
    telegram: 6,
    vk: 5,
    both: 3,
    no_channel: 0
  });
  const preview = await queryRetentionAudiencePreview(pool, 'at_risk');
  assert.deepEqual(preview, {
    segment: 'at_risk',
    total: 12,
    consented: 8,
    withoutConsent: 4,
    channels: { telegram: 6, vk: 5, both: 3, none: 0 }
  });
  assert.equal(pool.calls.length, 1);
  const sql = pool.calls[0].sql;
  assert.match(sql, /marketing_opt_in = TRUE AS consented/);
  assert.match(sql, /ui\.provider = 'telegram'/);
  assert.match(sql, /ui\.provider = 'vk'/);
  assert.match(sql, /last_activity_at < NOW\(\) - INTERVAL '30 days'/);
  assert.match(sql, /last_activity_at >= NOW\(\) - INTERVAL '60 days'/);
  assert.match(sql, /t\.status = 'completed'/);
  assert.match(sql, /t\.mode IN \('accrue','redeem'\)/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.equal(pool.calls[0].params, undefined);
});

test('sleeping preview uses the same lifecycle boundary as CRM', async () => {
  const pool = previewPool();
  const preview = await queryRetentionAudiencePreview(pool, 'sleeping');
  assert.equal(preview.segment, 'sleeping');
  const sql = pool.calls[0].sql;
  assert.match(sql, /last_activity_at < NOW\(\) - INTERVAL '60 days'/);
  assert.match(sql, /merged_into_user_id IS NULL/);
  assert.match(sql, /deleted_at IS NULL/);
});

test('retention preview requires a query-capable pool', async () => {
  await assert.rejects(() => queryRetentionAudiencePreview(null, 'at_risk'), /pool\.query is required/);
});
