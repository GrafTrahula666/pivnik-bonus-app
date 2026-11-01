import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { connectDatabase, initialState, EVENT_ID } from '../src/db.js';
import { Engine } from '../src/engine.js';
import { drawNight } from '../../halloween-raffle.js';

test('native PostgreSQL: two independent servers, canonical draw lock, restricted grants, crash/reconnect', { skip: !process.env.HALLOWEEN_TEST_DATABASE_URL }, async () => {
  // Explicit disposable fixture database only. Never use LIVE_DATABASE_URL here.
  const admin = new pg.Pool({ connectionString: process.env.HALLOWEEN_TEST_DATABASE_URL });
  const dbName = (await admin.query('SELECT current_database() AS name')).rows[0].name;
  assert.match(dbName, /^halloween_fixture/);
  await admin.query('DROP SCHEMA IF EXISTS halloween_live CASCADE; DROP TABLE IF EXISTS halloween_invite,halloween_invite_code,halloween_draw_snapshot_ticket,halloween_draw,halloween_ticket,halloween_ticket_balance,halloween_ticket_ledger,qr_aliases,users CASCADE');
  await admin.query('CREATE TABLE users(id bigint PRIMARY KEY,first_name text,last_name text,photo_url text,qr_token text,qr_short_code text,merged_into_user_id bigint); CREATE TABLE qr_aliases(user_id bigint,source_user_id bigint,qr_token text,qr_short_code text)');
  await admin.query(await readFile(new URL('../../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
  await admin.query(await readFile(new URL('../migrations/001_live.sql', import.meta.url), 'utf8'));
  for (let i = 1; i <= 8; i++) {
    await admin.query('INSERT INTO users VALUES($1,$2,NULL,NULL,$3,$4,NULL)', [i, `Fixture ${i}`, `fixture_token_000${i}`, `PVK-TEST-000${i}`]);
    await admin.query("INSERT INTO halloween_ticket_ledger(user_id,delta,reason,source_key) VALUES($1,$2,'admin',$3)", [i, i, `fixture:${i}`]);
    await admin.query('INSERT INTO halloween_ticket(user_id,source_key) SELECT $1,$2 FROM generate_series(1,$3::int)', [i, `fixture:${i}`, i]);
  }
  await admin.query('INSERT INTO halloween_live.events(id,state) VALUES($1,$2)', [EVENT_ID, JSON.stringify({ ...initialState(), mode: 'live' })]);
  await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='halloween_runtime') THEN CREATE ROLE halloween_runtime LOGIN PASSWORD 'fixture-runtime-only'; END IF; END $$");
  const grants = await readFile(new URL('../migrations/003_grants.example.sql', import.meta.url), 'utf8');
  await admin.query(grants.replaceAll('pivnik_halloween_live', 'halloween_runtime'));
  const runtimeUrl = new URL(process.env.HALLOWEEN_TEST_DATABASE_URL);
  runtimeUrl.username = 'halloween_runtime'; runtimeUrl.password = 'fixture-runtime-only';
  let one = await connectDatabase({ mode: 'live', url: runtimeUrl.href }), two = await connectDatabase({ mode: 'live', url: runtimeUrl.href });
  try {
    const e1 = new Engine(one), e2 = new Engine(two), owner = { role: 'owner', account: 'fixture-owner' };
    const execute = (e, action, input = {}, key = randomUUID()) => e.execute(owner, action, input, key);
    await assert.rejects(one.exclusive(c => c.query("UPDATE users SET first_name='bad' WHERE id=1")), /permission denied/);
    await assert.rejects(one.exclusive(c => c.query('UPDATE halloween_draw SET closes_at=now()')), /permission denied/);
    await assert.rejects(execute(e1, 'demo-close'), /forbidden/);
    const same = await Promise.all([execute(e1, 'register', { payload: 'PVK-TEST-0001' }), execute(e2, 'register', { payload: 'PVK-TEST-0001' })]);
    assert.equal(same.filter(r => !r.duplicate).length, 1);
    for (let i = 2; i <= 8; i++) await execute(e1, 'register', { payload: `PVK-TEST-000${i}` });
    const races = await Promise.allSettled([execute(e1, 'draw-local', { prizeId: 'beer1' }), execute(e2, 'draw-local', { prizeId: 'beer1' })]);
    assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
    await admin.query("UPDATE halloween_draw SET closes_at='2020-10-31T17:00:00Z'");
    await execute(e1, 'close-main');
    // The legacy canonical operation competes with the new service. Both agree on ONE saved result.
    const legacy = await admin.connect();
    try {
      const raced = await Promise.allSettled([drawNight(legacy), execute(e1, 'draw-main'), execute(e2, 'draw-main')]);
      assert.ok(raced.some(r => r.status === 'fulfilled'));
    } finally { legacy.release(); }
    const saved = (await admin.query('SELECT seed,results FROM halloween_draw')).rows[0];
    assert.equal((await e1.read()).main.seed, saved.seed);
    assert.deepEqual((await e1.read()).main.results, saved.results);
    assert.equal((await e1.read()).draws.length, 1);
    assert.ok((await e1.audit()).valid);
    const d = (await e1.read()).draws[0];
    await execute(e1, 'reveal', { drawId: d.id });
    const before = (await e1.read()).stage;
    await one.close(); one = await connectDatabase({ mode: 'live', url: runtimeUrl.href });
    assert.deepEqual((await new Engine(one).read()).stage, before);
    // The event cannot silently switch to a demo environment.
    await admin.query("UPDATE halloween_live.events SET state=jsonb_set(state,'{mode}','\"demo\"')");
    await assert.rejects(connectDatabase({ mode: 'live', url: runtimeUrl.href }), /Manual live migration/);
  } finally { await one.close(); await two.close(); await admin.end(); }
});
