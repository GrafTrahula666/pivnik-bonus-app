import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { getLeagueSeasons } from '../league-seasons.js';

test('Past seasons: Moscow months, merged purchases, cancellation, ties and privacy', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id bigint PRIMARY KEY, merged_into_user_id bigint, deleted_at timestamptz,
        first_name text, last_name text, photo_url text DEFAULT 'https://example.com/avatar',
        avatar_source text DEFAULT 'telegram', avatar_key text DEFAULT 'male-1',
        profile_frame text DEFAULT 'money', role text DEFAULT 'client', telegram_id bigint,
        unlimited_bonus boolean DEFAULT false, profile_public boolean DEFAULT true,
        show_name boolean DEFAULT true, show_avatar boolean DEFAULT true,
        show_leaderboard_amount boolean DEFAULT true
      );
      CREATE TABLE transactions (
        client_id bigint, created_at timestamptz, cash_paid_cents bigint,
        status text DEFAULT 'completed', mode text DEFAULT 'accrue'
      );
      INSERT INTO users (id, first_name, last_name) VALUES
        (1, 'Анна', 'Иванова'), (2, 'Борис', NULL), (3, 'Вера', NULL),
        (4, 'Старый', NULL), (5, 'Связанный', NULL), (6, 'Удалённый', NULL),
        (7, 'Приватный', NULL), (8, 'Ограниченный', NULL), (9, 'Без покупок', NULL);
      UPDATE users SET merged_into_user_id=2 WHERE id=4;
      UPDATE users SET merged_into_user_id=4 WHERE id=5;
      UPDATE users SET deleted_at=NOW() WHERE id=6;
      UPDATE users SET profile_public=false WHERE id=7;
      UPDATE users SET show_name=false, show_avatar=false, show_leaderboard_amount=false WHERE id=8;
      INSERT INTO transactions (client_id, created_at, cash_paid_cents) VALUES
        (1, '2026-09-10T12:00Z', 130000), (2, '2026-09-10T12:00Z', 50000),
        (4, '2026-09-10T12:00Z', 50000), (5, '2026-09-10T12:00Z', 50000),
        (3, '2026-08-31T21:00Z', 1000), (7, '2026-09-10T12:00Z', 100000),
        (6, '2026-09-10T12:00Z', 999999), (9, '2026-09-10T12:00Z', 0),
        (1, '2026-09-30T21:00Z', 999999), (3, '2026-10-20T12:00Z', 999999),
        (1, '2026-08-31T20:59:59Z', 20000), (3, '2026-08-10T12:00Z', 20000),
        (8, '2026-08-10T12:00Z', 10000), (2, '2026-08-10T12:00Z', 1000),
        (3, '2026-07-10T12:00Z', 30000);
      INSERT INTO transactions (client_id, created_at, cash_paid_cents, status, mode) VALUES
        (3, '2026-09-10T12:00Z', 999999, 'cancelled', 'accrue'),
        (3, '2026-09-10T12:00Z', 999999, 'pending', 'accrue'),
        (3, '2026-09-10T12:00Z', 999999, 'completed', 'admin_adjustment'),
        (2, '2026-09-10T12:00Z', 10000, 'completed', 'redeem');
    `);
    const frame = (row) => row.profile_frame;
    const asOf = '2026-10-15T12:00Z';
    const archive = await getLeagueSeasons(db, 1, frame, asOf);
    assert.deepEqual(archive.seasons.map(s => s.monthCode), ['2026-09', '2026-08', '2026-07']);
    assert.deepEqual(archive.seasons.map(s => s.leaders.length), [3, 3, 1]);
    assert.deepEqual(archive.seasons[0].leaders.map(l => [l.rank, l.name, l.spend]),
      [[1, 'Борис', 1600], [2, 'Анна И.', 1300], [3, 'Скрытый гость', null]]);
    assert.equal(archive.seasons[0].leaders[1].isMe, true);
    assert.deepEqual(archive.seasons[1].leaders.map(l => l.name), ['Анна И.', 'Вера', 'Скрытый гость']);
    for (const hidden of [archive.seasons[0].leaders[2], archive.seasons[1].leaders[2]]) {
      assert.equal(hidden.showAvatar, false);
      assert.equal(hidden.avatarSource, null);
      assert.equal(hidden.avatarKey, null);
      assert.equal(hidden.photoUrl, null);
      assert.equal(hidden.profileFrame, 'none');
      assert.equal(hidden.spend, null);
      assert.equal('id' in hidden, false);
      assert.equal('telegram_id' in hidden, false);
    }
    const self = await getLeagueSeasons(db, 7, frame, asOf);
    assert.equal(self.seasons[0].leaders[2].name, 'Приватный');
    assert.equal(self.seasons[0].leaders[2].spend, 1000);
    assert.equal(self.seasons[0].leaders[2].showAvatar, true);
    const mergedSelf = await getLeagueSeasons(db, 5, frame, asOf);
    assert.equal(mergedSelf.seasons[0].leaders[0].isMe, true);
    await db.exec('DELETE FROM transactions');
    assert.deepEqual(await getLeagueSeasons(db, 1, frame, asOf), { seasons: [] });
  } finally {
    await db.close();
  }
});

test('Both server archive routes enforce auth/consent and call the shared calculation', async () => {
  for (const file of ['server.js', 'universal-server.js']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ getLeagueSeasons \} from '\.\/league-seasons\.js'/);
    const calls = [];
    const db = {};
    const frame = () => 'none';
    const archive = { seasons: [{ monthCode: '2026-09', leaders: [] }] };
    const shared = async (...args) => { calls.push(args); return archive; };
    let body, status, authenticated = 0;
    if (file === 'server.js') {
      let handler;
      const authRequired = () => {};
      const app = { get(path, auth, fn) {
        assert.equal(path, '/api/leaderboard/seasons');
        assert.equal(auth, authRequired);
        handler = fn;
      } };
      const start = source.indexOf("app.get('/api/leaderboard/seasons'");
      vm.runInNewContext(source.slice(start, source.indexOf("app.get('/api/leaderboard/monthly'", start)),
        { app, authRequired, pool: db, profileFrameFromRow: frame, getLeagueSeasons: shared });
      const res = { status(n) { status = n; return this; }, json(data) { body = data; } };
      await handler({ user: { id: 1, termsAccepted: false } }, res, assert.fail);
      assert.equal(status, 428);
      assert.equal(calls.length, 0);
      await handler({ user: { id: 1, termsAccepted: true } }, res, assert.fail);
    } else {
      let accepted = false;
      const start = source.indexOf("    if (req.method === 'GET' && url.pathname === '/api/leaderboard/seasons')");
      const code = source.slice(start, source.indexOf("    if (req.method === 'GET' && url.pathname === '/api/leaderboard/monthly')", start));
      const context = {
        req: { method: 'GET' }, url: { pathname: '/api/leaderboard/seasons' }, res: {},
        pool: db, profileFrameFromRow: frame, getLeagueSeasons: shared,
        requireGatewayUser: async () => { authenticated++; return { id: 1, termsAccepted: accepted }; },
        sendJson: (_res, n, data) => { status = n; body = data; }
      };
      await vm.runInNewContext(`(async () => {${code}})()`, context);
      assert.equal(authenticated, 1);
      assert.equal(status, 428);
      assert.equal(calls.length, 0);
      accepted = true;
      await vm.runInNewContext(`(async () => {${code}})()`, context);
      assert.equal(status, 200);
      context.requireGatewayUser = async () => { throw new Error('unauthenticated'); };
      await assert.rejects(vm.runInNewContext(`(async () => {${code}})()`, context), /unauthenticated/);
      assert.equal(calls.length, 1);
    }
    assert.equal(body, archive);
    assert.deepEqual(calls[0], [db, 1, frame]);
  }
});
