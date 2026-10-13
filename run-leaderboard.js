// Pivnik Run all-time leaderboard: signed run tickets, plausibility check and the board queries.
import crypto from 'node:crypto';

export const RUN_TICKET_TTL_MS = 30 * 60 * 1000;
export const RUN_MIN_MS = 3000;
// The game tops out around 240 units/s, ×10 while time is slowed and ×1.5 for the skater, plus bonuses.
export const RUN_MAX_RATE = 2600;
export const RUN_SCORE_SLACK = 3000;
export const RUN_BOARD_LIMIT = 20;
const RUN_CHARS = new Set(['vitaliy', 'anya', 'kirill', 'hristina', 'vlad', 'dima', 'sema']);

const sign = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('base64url');

export function issueRunTicket(secret, userId, now = Date.now()) {
  const body = `${String(userId)}.${now}.${crypto.randomBytes(6).toString('base64url')}`;
  return `${body}.${sign(secret, body)}`;
}

export function readRunTicket(secret, ticket, userId, now = Date.now()) {
  const parts = String(ticket || '').split('.');
  if (parts.length !== 4) return null;
  const [uid, ts, nonce, mac] = parts;
  const expected = sign(secret, `${uid}.${ts}.${nonce}`);
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (uid !== String(userId)) return null;
  const startedAt = Number(ts);
  if (!Number.isFinite(startedAt) || startedAt > now + 5000 || now - startedAt > RUN_TICKET_TTL_MS) return null;
  return { startedAt };
}

export function plausibleScore(score, elapsedMs) {
  if (!Number.isSafeInteger(score) || score < 0) return false;
  if (elapsedMs < RUN_MIN_MS) return score === 0;
  return score <= Math.floor(elapsedMs / 1000) * RUN_MAX_RATE + RUN_SCORE_SLACK;
}

export const normalizeRunChar = (value) => (RUN_CHARS.has(String(value)) ? String(value) : null);

export function boardName(row) {
  const first = String(row.first_name || 'Гость').trim();
  const last = String(row.last_name || '').trim();
  return last ? `${first} ${last.slice(0, 1)}.` : first;
}

export async function submitRunScore(db, userId, score, character) {
  const result = await db.query(
    `INSERT INTO run_scores (user_id, best_score, best_char)
     VALUES ($1::bigint, $2::bigint, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       runs = run_scores.runs + 1,
       best_char = CASE WHEN EXCLUDED.best_score > run_scores.best_score THEN EXCLUDED.best_char ELSE run_scores.best_char END,
       updated_at = CASE WHEN EXCLUDED.best_score > run_scores.best_score THEN NOW() ELSE run_scores.updated_at END,
       best_score = GREATEST(run_scores.best_score, EXCLUDED.best_score)
     RETURNING best_score`,
    [userId, score, character]
  );
  return Number(result.rows[0].best_score);
}

export async function runBoard(db, userId, limit = RUN_BOARD_LIMIT) {
  const visible = `u.merged_into_user_id IS NULL AND u.deleted_at IS NULL AND rs.best_score > 0`;
  const top = await db.query(
    `SELECT u.id, u.first_name, u.last_name, u.profile_public, u.show_name, rs.best_score, rs.best_char,
            RANK() OVER (ORDER BY rs.best_score DESC, rs.updated_at ASC, u.id ASC) AS rank
     FROM run_scores rs JOIN users u ON u.id = rs.user_id
     WHERE ${visible}
     ORDER BY rank LIMIT $1`,
    [limit]
  );
  const mine = await db.query(
    `SELECT rs.best_score, rs.best_char,
            1 + (SELECT COUNT(*) FROM run_scores o JOIN users ou ON ou.id = o.user_id
                 WHERE ou.merged_into_user_id IS NULL AND ou.deleted_at IS NULL
                   AND (o.best_score > rs.best_score OR (o.best_score = rs.best_score AND (o.updated_at < rs.updated_at OR (o.updated_at = rs.updated_at AND o.user_id < rs.user_id))))) AS rank
     FROM run_scores rs JOIN users u ON u.id = rs.user_id
     WHERE rs.user_id = $1::bigint AND ${visible}`,
    [userId]
  );
  const total = await db.query(
    `SELECT COUNT(*)::int AS n FROM run_scores rs JOIN users u ON u.id = rs.user_id WHERE ${visible}`
  );
  return {
    leaders: top.rows.map((row) => {
      const isMe = String(row.id) === String(userId);
      const showName = isMe || (row.profile_public !== false && row.show_name !== false);
      return {
        rank: Number(row.rank),
        name: showName ? boardName(row) : 'Скрытый гость',
        score: Number(row.best_score),
        character: row.best_char || null,
        isMe
      };
    }),
    me: mine.rows[0]
      ? { rank: Number(mine.rows[0].rank), score: Number(mine.rows[0].best_score), character: mine.rows[0].best_char || null }
      : null,
    total: total.rows[0].n
  };
}
