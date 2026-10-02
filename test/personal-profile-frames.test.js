import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { GOLD_BARS_FRAME, giftedFrameChoices, grantPersonalTelegramFrames, findSevTroutTelegramId } from '../personal-profile-frames.js';

const read = (name) => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('both real servers resolve and allow the persisted personal gifts', async () => {
  for (const name of ['server.js', 'universal-server.js']) {
    const source = await read(name);
    const catalog = source.slice(source.indexOf('const OWNER_FRAME_CATALOG'), source.indexOf('function achievementsFromRow'));
    const available = source.slice(source.indexOf('function availableFramesFromRow'), source.indexOf('\nfunction ', source.indexOf('function availableFramesFromRow') + 1));
    const context = vm.createContext({ GOLD_BARS_FRAME, giftedFrameChoices, isIceCream69ARow: () => false, isAnnaRow: () => false, isOwnerRow: (row) => row.telegram_id === '101' });
    // Gateway defines availableFrames within catalog; standalone defines it later.
    vm.runInContext(catalog + (catalog.includes('function availableFramesFromRow') ? '' : available), context);
    for (const row of [{ telegram_id: '101', profile_frame: 'gold-bars' }, { telegram_id: '202', profile_frame: 'money' }]) {
      context.row = row;
      assert.equal(vm.runInContext('profileFrameFromRow(row)', context), row.profile_frame);
      assert.ok(vm.runInContext('availableFramesFromRow(row)', context).some((frame) => frame.code === row.profile_frame));
    }
    context.row = { telegram_id: '303', username: 'SevTrout', profile_frame: 'none' };
    assert.equal(vm.runInContext('profileFrameFromRow(row)', context), 'none', 'username alone must never grant a gift');
    assert.ok(!vm.runInContext('availableFramesFromRow(row)', context).some((frame) => frame.code === 'gold-bars'));
    context.row = { telegram_id: '202', profile_frame: 'none', owns_money_frame: true };
    assert.ok(vm.runInContext('availableFramesFromRow(row)', context).some((frame) => frame.code === 'money'), 'the gift stays available after choosing no frame');
  }
});

test('real client renders a stationary layer and six independent ingots', async () => {
  const source = await read('app.js');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function avatarFrameClass'), source.indexOf('function avatarInlineHtml')), context);
  const markup = vm.runInContext("avatarOrbitHtml({profileFrame:'gold-bars'})", context);
  assert.equal((markup.match(/class="gold-orbital-base"/g) || []).length, 1);
  assert.equal((markup.match(/class="gold-ingot"/g) || []).length, 6);
  assert.equal(vm.runInContext("avatarFrameClass({profileFrame:'gold-bars'})", context), 'avatar-frame avatar-frame-gold-bars');
  assert.equal((vm.runInContext("avatarOrbitHtml({profileFrame:'money'})", context).match(/<i /g) || []).length, 8);
});

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users(id BIGINT PRIMARY KEY, telegram_id BIGINT, username TEXT, profile_frame TEXT,
      merged_into_user_id BIGINT, deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, balance BIGINT);
    CREATE TABLE user_identities(user_id BIGINT, provider TEXT, provider_user_id TEXT, provider_username TEXT);
    CREATE TABLE user_frames(user_id BIGINT, frame_id TEXT, acquired_source TEXT, restored_from_legacy BOOLEAN,
      UNIQUE(user_id, frame_id));
    CREATE TABLE beta_grants(code TEXT, user_id BIGINT, amount BIGINT, UNIQUE(code, user_id));
    INSERT INTO users VALUES(1,101,'owner','money',NULL,NULL,NOW(),1000),(2,202,'SevTrout','none',NULL,NULL,NOW(),50);
    INSERT INTO user_identities VALUES(1,'telegram','101','owner'),(2,'telegram','202','SevTrout');
  `);
  // PGlite does not implement advisory locks; all identity and write SQL runs unchanged.
  return { db, client: { query: (sql, args) => sql.includes('pg_advisory_xact_lock') ? Promise.resolve({ rows: [] }) : db.query(sql, args) } };
}

test('issuance dry run writes nothing; repeated application grants only two frames', async () => {
  const { db, client } = await database();
  try {
    const args = { ownerTelegramId: '101', sevTroutTelegramId: '202' };
    assert.equal((await grantPersonalTelegramFrames(client, args)).applied, false);
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM user_frames')).rows[0].n, 0);
    for (let i = 0; i < 2; i++) await grantPersonalTelegramFrames(client, { ...args, apply: true });
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM user_frames')).rows[0].n, 2);
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM beta_grants')).rows[0].n, 2);
    const users = (await db.query('SELECT profile_frame, balance FROM users ORDER BY id')).rows;
    assert.deepEqual(users, [{ profile_frame: 'gold-bars', balance: 1000 }, { profile_frame: 'money', balance: 50 }]);
  } finally { await db.close(); }
});

test('Telegram recipient lookup excludes VK handles and rejects duplicate Telegram matches', async () => {
  const { db, client } = await database();
  try {
    await db.query("INSERT INTO users(id,username,profile_frame) VALUES(3,'SevTrout','none')");
    await db.query("INSERT INTO user_identities VALUES(3,'vk','303','SevTrout')");
    assert.equal(await findSevTroutTelegramId(client), '202');
    await db.query("UPDATE users SET telegram_id = 303 WHERE id = 3");
    await assert.rejects(findSevTroutTelegramId(client), /exactly one active/);
    await db.query("UPDATE users SET telegram_id = NULL WHERE id = 3");
    await db.query("UPDATE user_identities SET provider_username = 'renamed' WHERE user_id = 2");
    await assert.rejects(findSevTroutTelegramId(client), /exactly one active/);
  } finally { await db.close(); }
});

test('wrong handle, VK-only identity or ambiguous recipient fails before any gift is committed', async () => {
  const { db, client } = await database();
  try {
    await db.query("UPDATE user_identities SET provider_username = 'someoneelse' WHERE user_id = 2");
    await assert.rejects(grantPersonalTelegramFrames(client, { ownerTelegramId: '101', sevTroutTelegramId: '202', apply: true }), /does not belong/);
    await db.query("UPDATE user_identities SET provider = 'vk', provider_username = 'SevTrout' WHERE user_id = 2");
    await db.query('UPDATE users SET telegram_id = NULL WHERE id = 2');
    await assert.rejects(grantPersonalTelegramFrames(client, { ownerTelegramId: '101', sevTroutTelegramId: '202', apply: true }), /exactly one/);
    await db.query("INSERT INTO users(id,telegram_id,username,profile_frame) VALUES(3,101,'duplicate','none')");
    await assert.rejects(grantPersonalTelegramFrames(client, { ownerTelegramId: '101', sevTroutTelegramId: '202', apply: true }), /exactly one/);
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM user_frames')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('owner appearance repair keeps the new selection after startup and reauthentication', async () => {
  const { db } = await database();
  try {
    await db.query("UPDATE users SET profile_frame = 'gold-bars' WHERE id = 1");
    for (const name of ['server.js', 'universal-server.js']) {
      const source = await read(name);
      const expressions = [...source.matchAll(/profile_frame = (CASE WHEN [^\n]*?END)[,\n]/g)].map((match) => match[1]).filter((sql) => sql.includes("'gold-bars'"));
      assert.ok(expressions.length, `${name} must retain gold through owner repair`);
      for (const expression of expressions) {
        const sql = expression.replaceAll("$7", "'admin'");
        await db.query(`UPDATE users SET profile_frame = ${sql} WHERE id = 1`);
        assert.equal((await db.query('SELECT profile_frame FROM users WHERE id = 1')).rows[0].profile_frame, 'gold-bars');
      }
    }
  } finally { await db.close(); }
});

test('release issuer binds verification sessions to Telegram IDs and preserves selection on retry', async () => {
  const { signSession, verifySession } = await import('../platform-core.js');
  const { RAILWAY_PRODUCTION } = await import('../scripts/railway-production-config.mjs');
  const source = (await read('scripts/railway-grant-personal-frames.mjs')).replace(/^import .*;\n/gm, '');
  const targets = [{ userId: '1', telegramId: '101', frameId: 'gold-bars' }, { userId: '2', telegramId: '202', frameId: 'money' }];
  const release = 'a'.repeat(40);
  for (const phase of ['initial', 'retry', 'wrong-release']) {
    let grants = 0, verified = 0, connected = false;
    const previous = phase === 'retry' ? targets.map(t => ({ id: t.userId, telegram_id: t.telegramId, frame_id: t.frameId, profile_frame: 'none' })) : [];
    const context = vm.createContext({
      RAILWAY_PRODUCTION, URL, AbortSignal, signSession, PERSONAL_FRAME_GIFT_CODE: 'personal-frame-gift-20261002',
      process: { env: { RELEASE_COMMIT_SHA: release, RAILWAY_API_TOKEN: 'test-only' } },
      console: { log() {} },
      pg: { Client: class {
        async connect() { connected = true; }
        async end() {}
        async query(sql) {
          if (sql.includes('FROM beta_grants')) return { rows: previous };
          if (sql.includes('SELECT session_version')) return { rows: [{ session_version: 4 }] };
          throw new Error('Unexpected query');
        }
      } },
      findSevTroutTelegramId: async () => '202',
      grantPersonalTelegramFrames: async (_client, input) => { grants++; assert.equal(input.ownerTelegramId, '101'); return { targets }; },
      fetch: async (url, options) => {
        const reply = (data) => ({ ok: true, json: async () => data });
        if (url.includes('backboard.railway.com')) {
          const service = JSON.parse(options.body).variables.serviceId;
          return reply({ data: { variables: service === RAILWAY_PRODUCTION.services.postgres
            ? { DATABASE_PUBLIC_URL: 'postgres://test:test@public.invalid/db' }
            : { DATABASE_URL: 'postgres://test:test@internal.invalid/db', OWNER_TELEGRAM_ID: '101', SESSION_SECRET: 'test-secret' } } });
        }
        if (url.endsWith('/api/release-readiness')) return reply({ ok: true, releaseCommit: phase === 'wrong-release' ? 'b'.repeat(40) : release });
        if (url.includes('/assets/frames/')) return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new ArrayBuffer(0) };
        if (url.endsWith('/api/me')) {
          const payload = verifySession(options.headers.authorization.slice(7), 'test-secret');
          const target = targets.find(t => t.userId === payload.uid);
          assert.equal(payload.platform, 'telegram');
          assert.equal(payload.pid, target.telegramId, 'gateway requires the verified provider identity');
          assert.equal(payload.sv, 4);
          verified++;
          return reply({ id: target.userId, availableFrames: [{ code: target.frameId }], profileFrame: phase === 'retry' ? 'none' : target.frameId });
        }
        throw new Error('Unexpected URL');
      }
    });
    const run = vm.runInContext(`(async () => { ${source} })()`, context);
    if (phase === 'wrong-release') {
      await assert.rejects(run, /exact verified release/);
      assert.equal(connected, false);
      assert.equal(grants, 0);
    } else {
      await run;
      assert.equal(grants, phase === 'retry' ? 0 : 2);
      assert.equal(verified, 2);
    }
  }
});
