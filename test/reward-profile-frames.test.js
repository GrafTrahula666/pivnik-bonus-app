import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import * as frames from '../personal-profile-frames.js';

const read = (name) => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('both runtime servers expose earned prizes, keep them selectable, and reserve CREATOR for the configured owner', async () => {
  for (const name of ['server.js', 'universal-server.js']) {
    const source = await read(name);
    const catalog = source.slice(source.indexOf('const OWNER_FRAME_CATALOG'), source.indexOf('function achievementsFromRow'));
    const start = source.indexOf('function availableFramesFromRow');
    const available = source.slice(start, source.indexOf('\nfunction ', start + 1));
    const context = vm.createContext({ ...frames, ownerTelegramId: '101', ownerVkId: '909',
      isIceCream69ARow: () => false, isAnnaRow: () => false,
      isOwnerRow: (row) => row.telegram_id === '101' || row.role === 'admin' });
    vm.runInContext(catalog + (catalog.includes('function availableFramesFromRow') ? '' : available), context);
    const evaluate = (fn, row) => { context.row = row; return vm.runInContext(`${fn}(row)`, context); };
    for (const frame of frames.REWARD_FRAMES) {
      const row = { telegram_id: '202', profile_frame: frame.code, owned_frame_ids: [frame.code] };
      assert.equal(evaluate('profileFrameFromRow', row), frame.code, name);
      assert(evaluate('availableFramesFromRow', { ...row, profile_frame: 'none' }).some((f) => f.code === frame.code));
      assert(!evaluate('availableFramesFromRow', { telegram_id: '303' }).some((f) => f.code === frame.code));
    }
    const owner = { telegram_id: '101', profile_frame: frames.CREATOR_FRAME.code };
    assert.equal(evaluate('profileFrameFromRow', owner), frames.CREATOR_FRAME.code);
    const vkOwner = { profile_frame: frames.CREATOR_FRAME.code, frame_vk_identity_ids: ['909'] };
    assert.equal(evaluate('profileFrameFromRow', vkOwner), frames.CREATOR_FRAME.code);
    assert(evaluate('availableFramesFromRow', vkOwner).some((f) => f.code === frames.CREATOR_FRAME.code));
    assert.equal(evaluate('profileFrameFromRow', { ...vkOwner, frame_vk_identity_ids: ['910'] }), 'none');
    assert(evaluate('availableFramesFromRow', owner).some((f) => f.code === frames.CREATOR_FRAME.code));
    for (const row of [{ telegram_id: '202' }, { telegram_id: '202', role: 'admin' }, { username: 'CREATOR' }]) {
      const forged = { ...row, profile_frame: frames.CREATOR_FRAME.code, owned_frame_ids: [frames.CREATOR_FRAME.code] };
      assert.equal(evaluate('profileFrameFromRow', forged), 'none');
      assert(!evaluate('availableFramesFromRow', forged).some((f) => f.code === frames.CREATOR_FRAME.code));
    }
  }
});

test('real Business grant/revoke handlers persist each prize once and reject the private creator frame', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY, profile_frame TEXT, merged_into_user_id BIGINT, deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
      CREATE TABLE user_frames(id BIGSERIAL PRIMARY KEY, user_id BIGINT, frame_id TEXT, acquired_source TEXT, UNIQUE(user_id,frame_id));
      CREATE TABLE user_identities(user_id BIGINT, provider TEXT, provider_user_id TEXT);
      INSERT INTO user_identities VALUES(202,'vk','909');
      INSERT INTO users(id,profile_frame) VALUES(202,'none');`);
    const identityRow = (await db.query(`SELECT ${frames.FRAME_OWNER_IDENTITY_SQL} FROM users u WHERE u.id=202`)).rows[0];
    assert(frames.isCreatorFrameOwner(identityRow, '101', '909'));
    assert(!frames.isCreatorFrameOwner(identityRow, '101', '910'));
    const source = await read('server.js');
    const handlers = new Map();
    // pg exposes rowCount; PGlite exposes affectedRows for the same executed SQL.
    const query = async (...args) => { const result = await db.query(...args); return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }; };
    const context = vm.createContext({ ...frames, pool: { query, connect: async () => ({ query, release() {} }) },
      app: { post: (path, _auth, fn) => handlers.set('POST', fn), delete: (path, _auth, fn) => handlers.set('DELETE', fn) },
      requireBusinessService() {}, businessGuestRewards: async () => (await db.query('SELECT * FROM user_frames')).rows,
      businessError: (_res, error) => { throw error; } });
    const guest = source.indexOf('async function businessGuest(');
    vm.runInContext(source.slice(guest, source.indexOf('\nasync function ', guest + 1)), context);
    const start = source.indexOf("app.post('/api/internal/business/users/:id/frames'");
    const end = source.indexOf("app.get('/api/admin/users'", start);
    vm.runInContext(source.slice(start, end), context);
    const call = (method, code) => handlers.get(method)({ params: { id: '202', code }, body: { code } }, { json: (v) => v }, () => {});
    for (const frame of frames.REWARD_FRAMES) {
      await call('POST', frame.code);
      await assert.rejects(call('POST', frame.code), (e) => e.statusCode === 409);
      const rows = (await db.query('SELECT frame_id FROM user_frames WHERE user_id=202')).rows;
      assert(frames.giftedFrameChoices({ owned_frame_ids: rows.map((r) => r.frame_id) }).some((f) => f.code === frame.code));
      await db.query('UPDATE users SET profile_frame=$1 WHERE id=202', [frame.code]);
      await call('DELETE', frame.code);
      assert.equal((await db.query('SELECT profile_frame FROM users WHERE id=202')).rows[0].profile_frame, 'none');
      assert.equal((await db.query('SELECT COUNT(*) AS n FROM user_frames')).rows[0].n, 0);
    }
    await assert.rejects(call('POST', frames.CREATOR_FRAME.code), (e) => e.statusCode === 400);
    await assert.rejects(call('POST', 'unknown'), (e) => e.statusCode === 400);
  } finally { await db.close(); }
});

test('real avatar renderer isolates the moving dragon from the stationary CREATOR plaque and safely rejects unknown codes', async () => {
  const source = await read('app.js');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function avatarFrameClass'), source.indexOf('function avatarInlineHtml')), context);
  for (const frame of [...frames.REWARD_FRAMES, frames.CREATOR_FRAME]) {
    context.entity = { profileFrame: frame.code };
    const html = vm.runInContext('avatarOrbitHtml(entity)', context);
    assert.equal((html.match(/class="reward-frame-base"/g) || []).length, 1);
    assert.equal((html.match(/class="creator-dragon-orbit"/g) || []).length, frame.code === frames.CREATOR_FRAME.code ? 1 : 0);
    assert.match(vm.runInContext('avatarFrameClass(entity)', context), /avatar-frame-reward/);
  }
  context.entity = { profileFrame: '<img src=x onerror=alert(1)>' };
  assert.equal(vm.runInContext('avatarOrbitHtml(entity)', context), '');
  const css = await read('styles.css');
  const { parse, walk } = await import('css-tree');
  const ast = parse(css);
  const animations = new Set();
  walk(ast, (node) => { if (node.type === 'Atrule' && node.name === 'keyframes') animations.add(node.prelude.children.first.name); });
  assert(animations.has('creatorDragonOrbit'));
  assert.match(css, /\.creator-dragon-orbit\s*\{[^}]*animation: creatorDragonOrbit/s);
  const paths = [...css.matchAll(/url\(['"]?(\/assets\/frames\/(?:creator-|halloween-|infernal-|frost-|eclipse-)[^)'" ]+)/g)].map((m) => m[1]);
  assert.equal(new Set(paths).size, 6);
  for (const path of paths) { const data = await fs.readFile(new URL(`..${path}`, import.meta.url)); assert.equal(data.subarray(1,4).toString(), 'PNG'); }
});
