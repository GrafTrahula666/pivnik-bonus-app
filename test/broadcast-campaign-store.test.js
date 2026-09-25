import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BROADCAST_DEDUPE_WINDOW_MINUTES,
  broadcastCampaignFingerprint,
  createBroadcastCampaignStore,
  hashBroadcastMessage
} from '../broadcast-campaign-store.js';

function campaignRow(overrides = {}) {
  return {
    id: 1,
    actor_user_id: 7,
    channel: 'telegram',
    audience: 'clients',
    message_hash: hashBroadcastMessage('Привет'),
    fingerprint: broadcastCampaignFingerprint({ channel: 'telegram', audience: 'clients', message: 'Привет' }).fingerprint,
    status: 'processing',
    total_users: 12,
    truncated: false,
    telegram_attempted: 0,
    telegram_delivered: 0,
    telegram_failed: 0,
    vk_attempted: 0,
    vk_delivered: 0,
    vk_failed: 0,
    error_code: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides
  };
}

test('broadcast fingerprint is deterministic and stores only a message hash', () => {
  const first = broadcastCampaignFingerprint({ channel: 'telegram', audience: 'clients', message: 'Скидка сегодня' });
  const second = broadcastCampaignFingerprint({ channel: 'telegram', audience: 'clients', message: 'Скидка сегодня' });
  const changed = broadcastCampaignFingerprint({ channel: 'telegram', audience: 'clients', message: 'Другая акция' });

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.messageHash, hashBroadcastMessage('Скидка сегодня'));
  assert.equal(first.messageHash.length, 64);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.doesNotMatch(first.messageHash, /Скидка/);
});

test('broadcast audit schema is additive and excludes message body storage', async () => {
  const sql = [];
  const pool = {
    query: async (text) => { sql.push(text); return { rows: [], rowCount: 0 }; },
    connect: async () => { throw new Error('not used'); }
  };
  const store = createBroadcastCampaignStore(pool);
  await store.ensureSchema();

  const schema = sql.join('\n');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS broadcast_campaigns/);
  assert.match(schema, /actor_user_id BIGINT NOT NULL REFERENCES users\(id\)/);
  assert.match(schema, /message_hash TEXT NOT NULL/);
  assert.match(schema, /telegram_delivered INTEGER NOT NULL DEFAULT 0/);
  assert.match(schema, /fingerprint, created_at DESC/);
  assert.doesNotMatch(schema, /message_(?:text|body)|message TEXT/i);
});

test('claim serializes identical campaigns and does not pass plaintext message to INSERT', async () => {
  const calls = [];
  let released = false;
  const client = {
    async query(text, params = []) {
      calls.push({ text, params });
      if (/FROM broadcast_campaigns/.test(text)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO broadcast_campaigns/.test(text)) {
        return { rows: [campaignRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; }
  };
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => client
  };

  const store = createBroadcastCampaignStore(pool);
  const result = await store.claim({
    actorUserId: 7,
    channel: 'telegram',
    audience: 'clients',
    message: 'Привет',
    totalUsers: 12,
    truncated: false
  });

  assert.equal(result.created, true);
  assert.equal(result.campaign.id, '1');
  assert.equal(released, true);
  assert.match(calls[1].text, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(calls[2].text, new RegExp(`INTERVAL '${BROADCAST_DEDUPE_WINDOW_MINUTES} minutes'`));
  const insert = calls.find((call) => /INSERT INTO broadcast_campaigns/.test(call.text));
  assert.ok(insert);
  assert.equal(insert.params.includes('Привет'), false);
  assert.equal(insert.params.some((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)), true);
});

test('completed duplicate campaign returns stored outcome without another INSERT', async () => {
  const calls = [];
  const existing = campaignRow({
    status: 'completed',
    telegram_attempted: 12,
    telegram_delivered: 11,
    telegram_failed: 1,
    completed_at: new Date().toISOString()
  });
  const client = {
    async query(text, params = []) {
      calls.push({ text, params });
      if (/FROM broadcast_campaigns/.test(text)) return { rows: [existing], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => client
  };

  const store = createBroadcastCampaignStore(pool);
  const result = await store.claim({
    actorUserId: 99,
    channel: 'telegram',
    audience: 'clients',
    message: 'Привет',
    totalUsers: 12,
    truncated: false
  });

  assert.equal(result.created, false);
  assert.equal(result.campaign.status, 'completed');
  assert.equal(result.campaign.telegram.delivered, 11);
  assert.equal(calls.some((call) => /INSERT INTO broadcast_campaigns/.test(call.text)), false);
});

test('complete and fail persist only aggregate delivery outcome and safe error code', async () => {
  const calls = [];
  const pool = {
    async query(text, params) {
      calls.push({ text, params });
      if (/SET status = 'completed'/.test(text)) {
        return { rows: [campaignRow({
          status: 'completed',
          telegram_attempted: 5,
          telegram_delivered: 4,
          telegram_failed: 1,
          completed_at: new Date().toISOString()
        })], rowCount: 1 };
      }
      return { rows: [campaignRow({ status: 'failed', error_code: params[1] })], rowCount: 1 };
    },
    connect: async () => { throw new Error('not used'); }
  };
  const store = createBroadcastCampaignStore(pool);

  const completed = await store.complete(1, {
    telegram: { attempted: 5, delivered: 4, failed: 1 }
  });
  assert.equal(completed.telegram.delivered, 4);

  const failed = await store.fail(1, new Error('secret connection string should not be stored'));
  assert.equal(failed.errorCode, 'Error');
  assert.equal(calls.at(-1).params[1], 'Error');
  assert.equal(calls.at(-1).params.some((value) => String(value).includes('secret connection string')), false);
});
