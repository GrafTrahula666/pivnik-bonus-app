import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectDatabase, EVENT_ID } from '../src/db.js';
import { Engine, eligibleGuests, projection } from '../src/engine.js';
import { passwordHash, Auth } from '../src/auth.js';
import { createApplication } from '../src/server.js';
import { pickResults, createSeededRandomInt, snapshotHash } from '../../halloween-raffle.js';

const owner = { account: 'owner', role: 'owner' }, scanner = { account: 'scanner', role: 'scanner' };
const run = (e, action, input = {}, actor = owner, key = randomUUID()) => e.execute(actor, action, input, key);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pivnik-live-'));
  const db = await connectDatabase({ mode: 'demo', dataDir: join(dir, 'db') });
  t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });
  return { db, e: new Engine(db), dir };
}

test('existing QR formats, alias revocation, canonical IDs, concurrent dedup, no token in persisted event/audit', async t => {
  const { db, e } = await fixture(t);
  const token = 'DEMO_token_00000001';
  const results = await Promise.all([
    run(e, 'register', { payload: `PIVNIK:${token}` }, scanner),
    run(e, 'register', { payload: 'https://example.org/qr?code=PVK-DEMO-0001' }, scanner),
    run(e, 'register', { payload: JSON.stringify({ qrToken: `PIVNIK:${token}` }) }, scanner)
  ]);
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  assert.equal((await e.read()).guests.length, 1);
  await db.exclusive(c => c.query("INSERT INTO qr_aliases VALUES (2,1,'merged_token_12345','PVK-OLDX-0001'),(2,2,'revoked_token_12345','PVK-OLDX-0002')"));
  assert.equal((await run(e, 'register', { payload: 'PIVNIK:merged_token_12345' }, scanner)).guest.userId, '2');
  await assert.rejects(run(e, 'register', { payload: 'PIVNIK:revoked_token_12345' }, scanner), /guest_not_found/);
  const saved = await db.exclusive(async c => JSON.stringify((await c.query('SELECT state FROM halloween_live.events')).rows) + JSON.stringify((await c.query('SELECT * FROM halloween_live.audit')).rows) + JSON.stringify((await c.query('SELECT * FROM halloween_live.requests')).rows));
  assert.ok(!saved.includes(token)); assert.ok(!saved.includes('merged_token'));
  assert.ok((await e.audit()).valid);
});

test('idempotent replay, conflicting request keys, scanner permissions and public screen redaction', async t => {
  const { e } = await fixture(t);
  const key = randomUUID();
  const r = await run(e, 'register', { payload: 'PVK-DEMO-0001' }, scanner, key);
  assert.equal((await run(e, 'register', { payload: 'PVK-DEMO-0001' }, scanner, key)).replayed, true);
  await assert.rejects(run(e, 'register', { payload: 'PVK-DEMO-0002' }, scanner, key), /request_key_conflict/);
  await assert.rejects(run(e, 'draw-local', { prizeId: 'beer1' }, scanner), /forbidden/);
  await assert.rejects(run(e, 'settings', { excludeWinners: false }, scanner), /forbidden/);
  await assert.rejects(run(e, 'register', { payload: 'PVK-DEMO-0002' }, { account: 'tv', role: 'screen' }), /forbidden/);
  assert.equal(r.guest.userId, '1');
  const screen = projection(await e.read(), 'screen');
  assert.equal(screen.count, 1); assert.ok(!('guests' in screen)); assert.ok(!('main' in screen)); assert.ok(!('draws' in screen));
});

test('equal local chances, frozen snapshot, serialized draws, exclusion rules, absent reroll history and award finality', async t => {
  const { e } = await fixture(t);
  for (let i = 1; i <= 4; i++) await run(e, 'register', { payload: `PVK-DEMO-000${i}` });
  const draws = await Promise.allSettled([run(e, 'draw-local', { prizeId: 'beer1' }), run(e, 'draw-local', { prizeId: 'beer1' })]);
  assert.equal(draws.filter(r => r.status === 'fulfilled').length, 1);
  let s = await e.read(), d = s.draws[0];
  assert.equal(new Set(d.snapshot.map(p => p.userId)).size, 4); assert.equal(d.snapshot.length, 4);
  assert.ok(d.snapshot.some(g => g.userId === d.winner.userId));
  await assert.rejects(run(e, 'settings', { excludeWinners: false }), /rules_locked/);
  await run(e, 'register', { payload: 'PVK-DEMO-0005' });
  assert.equal((await e.read()).draws[0].snapshot.length, 4);
  await run(e, 'reveal', { drawId: d.id, kind: 'local' });
  await run(e, 'award', { drawId: d.id, status: 'absent', note: 'Нет в баре' });
  await assert.rejects(run(e, 'reroll', { drawId: d.id, reason: '' }), /reroll_not_allowed/);
  await run(e, 'reroll', { drawId: d.id, reason: 'Объявлено: отсутствующий победитель заменяется' });
  s = await e.read(); const replacement = s.draws[1];
  assert.equal(replacement.parentId, d.id); assert.notEqual(replacement.winner.userId, d.winner.userId);
  assert.equal(s.draws[0].winner.userId, d.winner.userId); assert.equal(s.draws[0].status, 'absent');
  await run(e, 'reveal', { drawId: replacement.id, kind: 'local' });
  await run(e, 'award', { drawId: replacement.id, status: 'given', note: 'Вручил владелец' });
  await assert.rejects(run(e, 'award', { drawId: replacement.id, status: 'given', note: 'Ещё раз' }), /award_final/);
  assert.equal(eligibleGuests(await e.read()).length, 3);
  await assert.rejects(run(e, 'remove', { userId: '5', reason: 'Ошибка' }), /confirmation_required/);
  await run(e, 'remove', { userId: '5', reason: 'Ошибка сканирования', confirm: true });
  assert.equal((await e.read()).guests.filter(g => g.active).length, 4);
});

test('repeat winner rule can be set before first draw; empty pool and registration closed fail', async t => {
  const { e } = await fixture(t);
  await assert.rejects(run(e, 'draw-local', { prizeId: 'beer1' }), /empty_local_pool/);
  await run(e, 'register', { payload: 'PVK-DEMO-0001' });
  await run(e, 'settings', { excludeWinners: false, registrationOpen: false });
  await assert.rejects(run(e, 'register', { payload: 'PVK-DEMO-0002' }), /registration_closed/);
  await run(e, 'draw-local', { prizeId: 'bonus100' });
  await run(e, 'reveal', { drawId: (await e.read()).draws[0].id });
  await run(e, 'draw-local', { prizeId: 'beer05' });
  assert.equal((await e.read()).draws[1].winner.userId, '1');
});

test('a merge after check-in cannot give the canonical account a second local chance', async t => {
  const { db, e } = await fixture(t);
  await run(e, 'register', { payload: 'PVK-DEMO-0001' });
  await run(e, 'register', { payload: 'PVK-DEMO-0002' });
  await db.exclusive(c => c.query('UPDATE users SET merged_into_user_id=2 WHERE id=1'));
  await run(e, 'draw-local', { prizeId: 'beer1' });
  const draw = (await e.read()).draws[0];
  assert.equal(draw.snapshot.length, 1); assert.equal(draw.winner.userId, '2');
});

test('reroll excludes the same person after an account merge even when repeat wins are allowed', async t => {
  const { db, e } = await fixture(t);
  await run(e, 'settings', { excludeWinners: false });
  await run(e, 'register', { payload: 'PVK-DEMO-0001' });
  await run(e, 'register', { payload: 'PVK-DEMO-0002' });
  await run(e, 'draw-local', { prizeId: 'beer1' });
  const d = (await e.read()).draws[0], target = d.winner.userId === '1' ? '2' : '1';
  await run(e, 'reveal', { drawId: d.id });
  await run(e, 'award', { drawId: d.id, status: 'absent', note: 'Отсутствует' });
  await db.exclusive(c => c.query('UPDATE users SET merged_into_user_id=$2 WHERE id=$1', [d.winner.userId, target]));
  await assert.rejects(run(e, 'reroll', { drawId: d.id, reason: 'Повтор по объявленному правилу' }), /empty_local_pool/);
});

test('canonical close time unchanged in live operation, atomic main, saved seed/snapshot, existing algorithm and reveal order', async t => {
  const { db, e } = await fixture(t);
  const before = (await e.read()).source.closesAt;
  await db.exclusive(c => c.query('UPDATE halloween_draw SET closes_at=$1', ['2099-10-31T17:00:00Z']));
  await assert.rejects(run(e, 'close-main'), /not_due/);
  assert.equal((await e.read()).source.closesAt, '2099-10-31T17:00:00.000Z');
  await assert.rejects(run(e, 'draw-main'), /not_closed/);
  await run(e, 'demo-close');
  const key = randomUUID(); await run(e, 'draw-main', {}, owner, key);
  assert.equal((await run(e, 'draw-main', {}, owner, key)).replayed, true);
  let s = await e.read(), m = s.main;
  assert.equal(m.snapshotHash, snapshotHash(m.snapshot));
  assert.deepEqual(m.results, pickResults(m.snapshot, createSeededRandomInt(m.seed)));
  assert.equal(new Set(['first', 'second', 'third'].map(k => m.results[k].userId)).size, 3);
  assert.equal(new Set(m.results.frames.map(r => r.userId)).size, 5);
  assert.deepEqual(m.slots.map(s => s.slot), ['frame1','frame2','frame3','frame4','frame5','third','second','first']);
  await assert.rejects(run(e, 'draw-main'), /main_already_drawn/);
  await assert.rejects(run(e, 'reveal', { kind: 'main', slot: 'first' }), /invalid_reveal_order/);
  for (const slot of m.slots) await run(e, 'reveal', { kind: 'main', slot: slot.slot });
  s = await e.read(); assert.equal(s.stage.slot, 'first');
  const canonical = await db.exclusive(c => c.query('SELECT seed,results,snapshot_hash FROM halloween_draw'));
  assert.equal(canonical.rows[0].seed, m.seed); assert.deepEqual(canonical.rows[0].results, m.results);
  assert.ok((await e.audit()).valid); assert.ok(before);
});

test('failed canonical verification rolls back main result, event revision and idempotency key', async t => {
  const { db, e } = await fixture(t);
  await run(e, 'demo-close');
  await db.exclusive(c => c.query("UPDATE halloween_draw SET snapshot_hash='tampered'"));
  const before = await e.read();
  await assert.rejects(run(e, 'draw-main'), /snapshot_mismatch/);
  const after = await e.read(); assert.equal(after.revision, before.revision); assert.equal(after.main, null);
  const rows = await db.exclusive(c => c.query('SELECT status FROM halloween_draw'));
  assert.equal(rows.rows[0].status, 'closed');
});

test('durable results and TV stage survive complete database/server restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pivnik-restart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let db = await connectDatabase({ mode: 'demo', dataDir: join(dir, 'db') }), e = new Engine(db);
  await run(e, 'register', { payload: 'PVK-DEMO-0001' });
  await run(e, 'draw-local', { prizeId: 'beer1' });
  await run(e, 'reveal', { drawId: (await e.read()).draws[0].id });
  const before = await e.read(); await db.close();
  db = await connectDatabase({ mode: 'demo', dataDir: join(dir, 'db') }); e = new Engine(db);
  assert.deepEqual((await e.read()).stage, before.stage);
  assert.deepEqual((await e.read()).draws, before.draws); assert.ok((await e.audit()).valid);
  await db.close();
});

test('HTTP auth, CSRF, role isolation, SSE sync and session revocation after logout', async t => {
  const { db } = await fixture(t);
  const accounts = ['owner', 'scanner', 'screen'].map(role => ({ name: role, role, passwordHash: passwordHash('test-password-123456') }));
  const application = await createApplication({ db, accounts, origin: 'http://localhost', secure: false });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { application.close(); await new Promise(r => server.close(r)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie, origin = 'http://localhost') => fetch(url + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie || '', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body) });
  assert.equal((await fetch(url + '/api/state')).status, 401);
  assert.equal((await post('/api/login', { account: 'owner', password: 'test-password-123456' }, '', 'https://evil.invalid')).status, 403);
  const login = await post('/api/login', { account: 'scanner', password: 'test-password-123456' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.ok(login.headers.get('set-cookie').includes('HttpOnly')); assert.ok(login.headers.get('set-cookie').includes('SameSite=Strict'));
  assert.equal((await fetch(url + '/api/state?view=control', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await post('/api/actions/draw-local', { prizeId: 'beer1' }, cookie)).status, 403);
  assert.equal((await post('/api/actions/register', { payload: 'PVK-DEMO-0001' }, cookie)).status, 200);
  const abort = new AbortController();
  const events = await fetch(url + '/api/events?view=scanner', { headers: { Cookie: cookie }, signal: abort.signal });
  const reader = events.body.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
  assert.ok(first.includes('"count":1'));
  await post('/api/actions/register', { payload: 'PVK-DEMO-0002' }, cookie);
  let data = ''; const deadline = Date.now() + 5000;
  while (!data.includes('"count":2') && Date.now() < deadline) data += new TextDecoder().decode((await reader.read()).value);
  assert.ok(data.includes('"count":2')); abort.abort();
  assert.equal((await post('/api/logout', {}, cookie)).status, 200);
  assert.equal((await fetch(url + '/api/me', { headers: { Cookie: cookie } })).status, 401);
});

test('passwordless demo scanner opens without credentials and cannot operate the raffle or bypass live auth', async t => {
  const { db } = await fixture(t);
  const accounts = ['owner', 'scanner'].map(role => ({ name: role, role, passwordHash: passwordHash('test-password-123456') }));
  const application = await createApplication({ db, accounts, origin: 'http://localhost', secure: false });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { application.close(); await new Promise(r => server.close(r)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body = {}, cookie = '', origin = 'http://localhost') => fetch(url + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body) });
  assert.equal((await post('/api/demo-scanner', {}, '', 'https://evil.invalid')).status, 403);
  const login = await post('/api/demo-scanner');
  assert.equal(login.status, 200);
  assert.equal((await login.json()).role, 'scanner');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url + '/api/state?view=scanner', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(url + '/api/state?view=control', { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await post('/api/actions/draw-local', { prizeId: 'beer1' }, cookie)).status, 403);
  assert.equal((await post('/api/actions/register', { payload: 'PVK-DEMO-0001' }, cookie)).status, 200);
  const ownerLogin = await post('/api/login', { account: 'owner', password: 'test-password-123456' });
  const ownerCookie = ownerLogin.headers.get('set-cookie').split(';')[0];
  const preserved = await post('/api/demo-scanner', {}, ownerCookie);
  assert.equal((await preserved.json()).role, 'owner');
  assert.equal(preserved.headers.get('set-cookie'), null);
  db.demo = false;
  try { assert.equal((await post('/api/demo-scanner')).status, 403); }
  finally { db.demo = true; }
});

test('credential rotation revokes sessions; demo refuses to fallback from missing live configuration', async t => {
  const { db } = await fixture(t);
  const original = { name: 'owner', role: 'owner', passwordHash: passwordHash('test-password-123456') };
  const a = new Auth(db, [original]), session = await a.login('owner', 'test-password-123456', 'local');
  assert.equal((await a.session(session.token)).role, 'owner');
  const rotated = new Auth(db, [{ ...original, passwordHash: passwordHash('changed-password-123456') }]);
  assert.equal(await rotated.session(session.token), null);
  await assert.rejects(connectDatabase({ mode: 'live' }), /configure LIVE_DATABASE_URL/);
  await assert.rejects(connectDatabase({}), /configure LIVE_DATABASE_URL/);
});

test('bonus issuance retries the existing operation with one stable reference after an ambiguous failure', async t => {
  const { db, e } = await fixture(t);
  await run(e, 'register', { payload: 'PVK-DEMO-0001' });
  await run(e, 'draw-local', { prizeId: 'bonus100' });
  const draw = (await e.read()).draws[0];
  await run(e, 'reveal', { drawId: draw.id });
  await db.exclusive(c => c.query("UPDATE halloween_live.events SET state=jsonb_set(state,'{mode}','\"live\"') WHERE id=$1", [EVENT_ID]));
  await assert.rejects(run(e, 'award', { drawId: draw.id, status: 'given', note: 'Приз вручён' }), /reward_bridge_not_configured/);
  const issued = new Set(); let calls = 0;
  e.rewardBridge = async input => {
    calls++; issued.add(input.requestKey);
    assert.equal(input.userId, '1'); assert.equal(input.amount, 100);
    if (calls === 1) throw new Error('response lost after canonical operation committed');
  };
  await assert.rejects(run(e, 'award', { drawId: draw.id, status: 'given', note: 'Приз вручён' }), /response lost/);
  assert.equal((await e.read()).draws[0].status, 'pending');
  await run(e, 'award', { drawId: draw.id, status: 'given', note: 'Приз вручён' });
  assert.equal(issued.size, 1); assert.equal(calls, 2);
  assert.equal((await e.read()).draws[0].status, 'given');
});
