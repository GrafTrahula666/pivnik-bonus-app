import { resolvePersonalQrRecord } from '../../qr-resolver.js';
import { isDeepStrictEqual } from 'node:util';
import { closeDraw, drawNight, DRAW_ID, snapshotHash, pickResults, createSeededRandomInt } from '../../halloween-raffle.js';

export class LiveError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export function person(row) {
  return { userId: String(row.id), name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Гость',
    // Do not forward arbitrary schemes or credentials to browsers.
    photo: /^https:\/\/[^/@]+(?:\/|$)/i.test(row.photo_url || '') ? row.photo_url : null };
}
export async function resolveGuest(c, payload) {
  if (typeof payload !== 'string' || payload.length > 2048) throw new LiveError('invalid_qr', 400);
  const resolved = await resolvePersonalQrRecord(c, payload);
  if (!resolved) throw new LiveError('guest_not_found', 404);
  const { rows } = await c.query('SELECT id,first_name,last_name,photo_url FROM users WHERE id=$1 AND merged_into_user_id IS NULL', [resolved.id]);
  if (!rows.length) throw new LiveError('guest_not_found', 404);
  return person(rows[0]);
}
export async function reconcileGuests(c, state) {
  const active = state.guests.filter(g => g.active);
  const ids = [...new Set([...active.map(g => g.userId), ...state.draws.map(d => d.winner.userId)])];
  if (!ids.length) return;
  // One MVCC statement for the complete list; do not issue N queries per scan.
  const { rows } = await c.query(`WITH RECURSIVE chain AS (
    SELECT id AS original_id,id,first_name,last_name,photo_url,merged_into_user_id,ARRAY[id] AS path
    FROM users WHERE id=ANY($1::bigint[])
    UNION ALL
    SELECT ch.original_id,u.id,u.first_name,u.last_name,u.photo_url,u.merged_into_user_id,ch.path||u.id
    FROM chain ch JOIN users u ON u.id=ch.merged_into_user_id
    WHERE NOT u.id=ANY(ch.path) AND cardinality(ch.path)<12
  ) SELECT * FROM chain WHERE merged_into_user_id IS NULL OR merged_into_user_id=ANY(path) OR cardinality(path)>=12`, [ids]);
  if (rows.some(r => r.merged_into_user_id != null)) throw new LiveError('identity_merge_cycle', 503);
  const identity = new Map(rows.map(r => [String(r.original_id), r]));
  state.canonicalWinnerMap = Object.fromEntries(state.draws.map(d => [d.winner.userId, String(identity.get(d.winner.userId)?.id || d.winner.userId)]));
  state.canonicalWinnerIds = [...new Set(state.draws.map(d => identity.get(d.winner.userId)?.id).filter(Boolean).map(String))];
  const canonical = new Set();
  for (const guest of active) {
    const row = identity.get(guest.userId);
    if (!row || canonical.has(String(row.id))) { guest.active = false; guest.removedReason = 'canonical_identity_changed'; continue; }
    if (guest.userId !== String(row.id)) guest.previousUserIds = [...new Set([...(guest.previousUserIds || []), guest.userId])];
    Object.assign(guest, person(row)); canonical.add(guest.userId);
  }
}
export async function summary(c) {
  const { rows } = await c.query(`SELECT d.status,d.closes_at,d.snapshot_hash,
    CASE WHEN d.status='open' THEN (SELECT count(*)::int FROM halloween_ticket WHERE status='active')
      ELSE (SELECT count(*)::int FROM halloween_draw_snapshot_ticket) END AS tickets,
    CASE WHEN d.status='open' THEN (SELECT count(DISTINCT user_id)::int FROM halloween_ticket WHERE status='active')
      ELSE (SELECT count(DISTINCT user_id)::int FROM halloween_draw_snapshot_ticket) END AS participants
    FROM halloween_draw d WHERE id=$1`, [DRAW_ID]);
  if (!rows.length) throw new LiveError('canonical_draw_missing', 503);
  const r = rows[0];
  return { status: r.status, closesAt: new Date(r.closes_at).toISOString(), tickets: r.tickets, participants: r.participants };
}
// The existing helpers own BEGIN/COMMIT. This facade composes them into our
// outer event+request+audit transaction without committing it prematurely.
function withinTransaction(c) {
  return { query: (sql, params) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)
    ? Promise.resolve({ rows: [] }) : c.query(sql, params) };
}
export async function closeCanonical(c) { return closeDraw(withinTransaction(c)); }
export async function drawCanonical(c) {
  const { rows } = await c.query('SELECT status,seed,results,snapshot_hash FROM halloween_draw WHERE id=$1 FOR UPDATE', [DRAW_ID]);
  if (!rows.length) throw new LiveError('canonical_draw_missing', 503);
  const draw = rows[0];
  let result;
  if (draw.status === 'drawn') result = { seed: draw.seed, snapshotHash: draw.snapshot_hash, results: draw.results };
  else result = await drawNight(withinTransaction(c));
  const snapshot = (await c.query('SELECT number,user_id FROM halloween_draw_snapshot_ticket ORDER BY number')).rows
    .map(r => ({ number: Number(r.number), userId: Number(r.user_id) }));
  if (!snapshot.length) throw new LiveError('empty_main_pool');
  if (snapshotHash(snapshot) !== result.snapshotHash || !isDeepStrictEqual(pickResults(snapshot, createSeededRandomInt(result.seed)), result.results)) throw new LiveError('main_verification_failed');
  const slots = [];
  for (const slot of result.results.revealOrder) {
    const hit = slot.startsWith('frame') ? result.results.frames.find(f => f.slot === slot) : result.results[slot];
    const user = (await c.query('SELECT id,first_name,last_name,photo_url FROM users WHERE id=$1', [hit.userId])).rows[0];
    slots.push({ slot, winner: user ? { ...person(user), ticket: hit.ticket } : { userId: String(hit.userId), name: 'Гость', ticket: hit.ticket } });
  }
  return { ...result, snapshot, slots, revealed: [], createdAt: new Date().toISOString() };
}
