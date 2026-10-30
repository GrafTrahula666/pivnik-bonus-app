import { randomInt, randomUUID } from 'node:crypto';
import { EVENT_ID } from './db.js';
import { digest } from './auth.js';
import { LiveError, resolveGuest, reconcileGuests, summary, closeCanonical, drawCanonical } from './source.js';

const requireRole = (actor, roles) => { if (!roles.includes(actor.role)) throw new LiveError('forbidden', 403); };
const text = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const mainPrize = slot => slot === 'first' ? 'Депозит 5 000 ₽ · эксклюзивная рамка' : slot === 'second' ? 'Фирменная кружка · редкая рамка' : slot === 'third' ? '250 бонусов · депозит 500 ₽ · рамка' : 'Профильная рамка';
export function eligibleGuests(state, additionallyExcluded = []) {
  const excluded = new Set(additionallyExcluded);
  for (const id of additionallyExcluded) if (state.canonicalWinnerMap?.[id]) excluded.add(state.canonicalWinnerMap[id]);
  if (state.excludeWinners) for (const draw of state.draws) excluded.add(draw.winner.userId);
  if (state.excludeWinners) for (const id of state.canonicalWinnerIds || []) excluded.add(id);
  return state.guests.filter(g => g.active && !excluded.has(g.userId) && !(g.previousUserIds || []).some(id => excluded.has(id)));
}
export function verifyAudit(rows) {
  let prev = '';
  for (const row of rows) {
    if (row.previous_hash !== prev || digest(prev + JSON.stringify(row.payload)) !== row.hash) return false;
    prev = row.hash;
  }
  return true;
}
export class Engine {
  constructor(db, { rewardBridge } = {}) { this.db = db; this.rewardBridge = rewardBridge; }
  async read() {
    return this.db.exclusive(async c => {
      const r = (await c.query('SELECT state,revision FROM halloween_live.events WHERE id=$1', [EVENT_ID])).rows[0];
      const source = await summary(c);
      return { ...r.state, revision: Number(r.revision), source, eligible: eligibleGuests(r.state).length };
    });
  }
  async execute(actor, action, input, key) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key || '')) throw new LiveError('request_key_required', 400);
    if (actor.role === 'screen') throw new LiveError('forbidden', 403);
    const fingerprint = digest(JSON.stringify({ action, input }));
    return this.db.exclusive(async c => {
      await c.query('BEGIN');
      try {
        const row = (await c.query('SELECT state,revision FROM halloween_live.events WHERE id=$1 FOR UPDATE', [EVENT_ID])).rows[0];
        const replay = (await c.query('SELECT * FROM halloween_live.requests WHERE key=$1', [key])).rows[0];
        if (replay) {
          if (replay.actor !== actor.account || replay.action !== action || replay.fingerprint !== fingerprint) throw new LiveError('request_key_conflict');
          await c.query('COMMIT'); return { ...replay.response, replayed: true };
        }
        const state = row.state;
        const result = await this.apply(c, state, actor, action, input);
        const revision = Number(row.revision) + 1;
        await c.query('UPDATE halloween_live.events SET state=$2,revision=$3 WHERE id=$1', [EVENT_ID, JSON.stringify(state), revision]);
        // Never persist input: it can contain a full secret personal QR.
        const payload = { actor: actor.account, role: actor.role, action, revision, at: new Date().toISOString(), result };
        // jsonb reorders keys: hash the stored canonical serialization, not insertion order.
        const canonical = (await c.query('SELECT $1::jsonb AS payload', [JSON.stringify(payload)])).rows[0].payload;
        const previous = (await c.query('SELECT hash FROM halloween_live.audit WHERE event_id=$1 ORDER BY id DESC LIMIT 1', [EVENT_ID])).rows[0]?.hash || '';
        await c.query('INSERT INTO halloween_live.audit(event_id,payload,previous_hash,hash) VALUES($1,$2,$3,$4)', [EVENT_ID, JSON.stringify(canonical), previous, digest(previous + JSON.stringify(canonical))]);
        const response = { ok: true, ...result, revision };
        await c.query('INSERT INTO halloween_live.requests(key,actor,action,fingerprint,response) VALUES($1,$2,$3,$4,$5)', [key, actor.account, action, fingerprint, JSON.stringify(response)]);
        await c.query('COMMIT');
        return response;
      } catch (error) { await c.query('ROLLBACK'); throw error; }
    });
  }
  async apply(c, state, actor, action, input) {
    if (action === 'register') {
      requireRole(actor, ['owner', 'scanner', 'operator']);
      if (!state.registrationOpen) throw new LiveError('registration_closed');
      await reconcileGuests(c, state);
      const guest = await resolveGuest(c, input.payload);
      const existing = state.guests.find(g => g.userId === guest.userId);
      if (existing?.active) return { guest: existing, duplicate: true };
      if (existing) Object.assign(existing, guest, { active: true, registeredAt: new Date().toISOString() });
      else state.guests.push({ ...guest, number: state.guests.length + 1, active: true, registeredAt: new Date().toISOString() });
      return { guest: existing || state.guests.at(-1), duplicate: false };
    }
    if (action === 'remove') {
      requireRole(actor, ['owner', 'scanner']);
      if (input.confirm !== true || !text(input.reason)) throw new LiveError('confirmation_required', 400);
      const guest = state.guests.find(g => g.userId === input.userId && g.active);
      if (!guest) throw new LiveError('guest_not_found', 404);
      guest.active = false;
      return { userId: guest.userId, reason: text(input.reason) };
    }
    requireRole(actor, ['owner', 'operator']);
    if (action === 'settings') {
      if (typeof input.registrationOpen === 'boolean') state.registrationOpen = input.registrationOpen;
      if (typeof input.excludeWinners === 'boolean' && input.excludeWinners !== state.excludeWinners) {
        if (state.draws.length) throw new LiveError('rules_locked');
        state.excludeWinners = input.excludeWinners;
      }
      return { registrationOpen: state.registrationOpen, excludeWinners: state.excludeWinners };
    }
    if (action === 'prize') {
      const title = text(input.title, 100);
      if (!title) throw new LiveError('prize_title_required', 400);
      const kind = ['beer', 'bonus', 'custom'].includes(input.kind) ? input.kind : 'custom';
      const amount = Number(input.amount || 0);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10000 || (kind === 'beer' && ![500, 1000].includes(amount)) || (kind === 'bonus' && ![100, 250].includes(amount))) throw new LiveError('invalid_prize', 400);
      const prize = { id: text(input.id, 64) || randomUUID(), title, kind, amount };
      const index = state.prizes.findIndex(p => p.id === prize.id);
      if (index < 0) state.prizes.push(prize); else state.prizes[index] = prize;
      return { prize };
    }
    if (action === 'draw-local' || action === 'reroll') {
      if (state.draws.some(d => !d.revealedAt)) throw new LiveError('reveal_pending_draw_first');
      await reconcileGuests(c, state);
      let prize, parent, reason, excluded = [];
      if (action === 'reroll') {
        parent = state.draws.find(d => d.id === input.drawId);
        reason = text(input.reason);
        if (!parent || parent.status !== 'absent' || !reason || state.draws.some(d => d.parentId === parent.id)) throw new LiveError('reroll_not_allowed');
        prize = parent.prize;
        let current = parent;
        while (current) { excluded.push(current.winner.userId); current = state.draws.find(d => d.id === current.parentId); }
      } else prize = state.prizes.find(p => p.id === input.prizeId);
      if (!prize) throw new LiveError('prize_not_found', 404);
      const pool = eligibleGuests(state, excluded);
      if (!pool.length) throw new LiveError('empty_local_pool');
      const snapshot = pool.map(g => ({ userId: g.userId, number: g.number, name: g.name }));
      const winner = snapshot[randomInt(snapshot.length)];
      const draw = { id: randomUUID(), prize: { ...prize }, snapshot, snapshotHash: digest(JSON.stringify(snapshot)), winner,
        excludeWinners: state.excludeWinners, parentId: parent?.id || null, reason: reason || null,
        status: 'pending', createdAt: new Date().toISOString(), operator: actor.account };
      state.draws.push(draw);
      return { drawId: draw.id, pool: pool.length, snapshotHash: draw.snapshotHash };
    }
    if (action === 'close-main') { requireRole(actor, ['owner']); return await closeCanonical(c); }
    if (action === 'draw-main') {
      requireRole(actor, ['owner']);
      if (state.main) throw new LiveError('main_already_drawn');
      state.main = await drawCanonical(c);
      return { snapshotHash: state.main.snapshotHash, slots: state.main.slots.length };
    }
    if (action === 'reveal') {
      let winner, prize, kind, slot;
      if (input.kind === 'main') {
        const next = state.main?.slots.find(s => !state.main.revealed.includes(s.slot));
        if (!next || next.slot !== input.slot) throw new LiveError('invalid_reveal_order');
        state.main.revealed.push(next.slot);
        ({ winner, slot } = next); prize = mainPrize(slot); kind = 'main';
      } else {
        const draw = state.draws.find(d => d.id === input.drawId);
        if (!draw || draw.revealedAt) throw new LiveError('already_revealed');
        draw.revealedAt = new Date().toISOString();
        winner = draw.winner; prize = draw.prize.title; slot = draw.id; kind = 'local';
      }
      state.stage = { id: randomUUID(), status: 'reveal', kind, slot, winner, prize, startedAt: new Date().toISOString() };
      return { stageId: state.stage.id, slot };
    }
    if (action === 'waiting') { state.stage = { id: randomUUID(), status: 'waiting' }; return { waiting: true }; }
    if (action === 'award') {
      const draw = state.draws.find(d => d.id === input.drawId);
      if (!draw || !draw.revealedAt || !['pending', 'given', 'absent'].includes(input.status)) throw new LiveError('invalid_award');
      if (draw.status === 'given' || (draw.status === 'absent' && input.status !== 'absent')) throw new LiveError('award_final');
      const note = text(input.note, 300);
      if (input.status !== 'pending' && note.length < 3) throw new LiveError('award_note_required', 400);
      if (input.status === 'given' && draw.prize.kind === 'bonus' && state.mode === 'live') {
        if (!this.rewardBridge) throw new LiveError('reward_bridge_not_configured', 503);
        // Only the existing authenticated operation may touch money; stable request key survives a crash.
        const reference = `halloween-live:${EVENT_ID}:${draw.id}`;
        await this.rewardBridge({ userId: draw.winner.userId, amount: draw.prize.amount, requestKey: reference });
        draw.rewardReference = reference;
      }
      draw.status = input.status; draw.awardNote = note; draw.awardedBy = actor.account;
      draw.awardedAt = new Date().toISOString();
      return { drawId: draw.id, status: draw.status, note, reference: draw.rewardReference || null };
    }
    if (action === 'demo-close') {
      requireRole(actor, ['owner']);
      if (!this.db.demo || state.mode !== 'demo') throw new LiveError('forbidden', 403);
      // Demo only: never offer force-close for real tickets.
      await c.query('UPDATE halloween_draw SET closes_at=now()-interval \'1 minute\' WHERE id=$1', ['night-of-cauldrons']);
      return await closeCanonical(c);
    }
    throw new LiveError('unknown_action', 404);
  }
  async audit() {
    return this.db.exclusive(async c => {
      const rows = (await c.query('SELECT * FROM halloween_live.audit WHERE event_id=$1 ORDER BY id', [EVENT_ID])).rows;
      return { valid: verifyAudit(rows), rows };
    });
  }
}

export function projection(state, view) {
  const base = { mode: state.mode, revision: state.revision, count: state.guests.filter(g => g.active).length, registrationOpen: state.registrationOpen };
  if (view === 'screen') return { ...base, stage: state.stage };
  if (view === 'scanner') return { ...base, guests: state.guests.filter(g => g.active) };
  return { ...state, ...base };
}
