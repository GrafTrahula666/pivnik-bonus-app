import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  issueRunTicket, readRunTicket, plausibleScore, normalizeRunChar, submitRunScore, runBoard, boardName,
  RUN_MAX_RATE, RUN_SCORE_SLACK
} from '../run-leaderboard.js';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';

const secret = Buffer.from('test-secret');

test('a run ticket belongs to its user, is signed and expires', () => {
  const now = 1_000_000;
  const ticket = issueRunTicket(secret, '42', now);
  assert.deepEqual(readRunTicket(secret, ticket, '42', now + 60_000), { startedAt: now });
  assert.equal(readRunTicket(secret, ticket, '43', now + 60_000), null);
  assert.equal(readRunTicket(Buffer.from('other'), ticket, '42', now + 60_000), null);
  assert.equal(readRunTicket(secret, ticket, '42', now + 31 * 60_000), null);
  assert.equal(readRunTicket(secret, ticket.replace(/\.\d+\./, '.1.'), '42', now + 60_000), null);
  assert.equal(readRunTicket(secret, 'junk', '42', now), null);
});

test('scores must be integers that the elapsed run time can explain', () => {
  assert.equal(plausibleScore(1500, 10_000), true);
  assert.equal(plausibleScore(10 * RUN_MAX_RATE + RUN_SCORE_SLACK, 10_000), true);
  assert.equal(plausibleScore(10 * RUN_MAX_RATE + RUN_SCORE_SLACK + 1, 10_000), false);
  assert.equal(plausibleScore(5, 1000), false);
  assert.equal(plausibleScore(0, 1000), true);
  assert.equal(plausibleScore(-1, 60_000), false);
  assert.equal(plausibleScore(12.5, 60_000), false);
  assert.equal(plausibleScore(Number.NaN, 60_000), false);
});

test('character is whitelisted and names respect the short form', () => {
  assert.equal(normalizeRunChar('kirill'), 'kirill');
  assert.equal(normalizeRunChar('<script>'), null);
  assert.equal(boardName({ first_name: 'Кирилл', last_name: 'Борисов' }), 'Кирилл Б.');
  assert.equal(boardName({}), 'Гость');
});

test('submit keeps the best score only and the board hides private names', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ best_score: 777 }] }; } };
  assert.equal(await submitRunScore(db, '7', 500, 'vlad'), 777);
  assert.match(calls[0].sql, /GREATEST\(run_scores\.best_score, EXCLUDED\.best_score\)/);
  assert.deepEqual(calls[0].params, ['7', 500, 'vlad']);

  const rows = [
    [{ id: '1', first_name: 'Влад', last_name: 'К', profile_public: true, show_name: true, best_score: '900', best_char: 'vlad', rank: '1' },
     { id: '2', first_name: 'Аня', last_name: '', profile_public: false, show_name: true, best_score: '800', best_char: 'anya', rank: '2' },
     { id: '3', first_name: 'Я', last_name: '', profile_public: false, show_name: false, best_score: '700', best_char: null, rank: '3' }],
    [{ best_score: '700', best_char: null, rank: '3' }],
    [{ n: 3 }]
  ];
  const board = await runBoard({ query: async () => ({ rows: rows.shift() }) }, '3');
  assert.deepEqual(board.leaders.map((l) => l.name), ['Влад К.', 'Скрытый гость', 'Я']);
  assert.equal(board.leaders[2].isMe, true);
  assert.deepEqual(board.me, { rank: 3, score: 700, character: null });
  assert.equal(board.total, 3);
});

test('migration 016 is additive and automatic; the gateway wires the three routes behind login', async () => {
  const sql = await fs.readFile(new URL('../migrations/016_run_scores.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS run_scores/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|UPDATE|ALTER)\b/i);
  assert.equal(isAutomaticStartupMigration('016_run_scores.sql'), true);
  const gateway = await fs.readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
  for (const route of ['/api/run/start', '/api/run/score', '/api/run/leaderboard']) assert.ok(gateway.includes(route), route);
  const block = gateway.slice(gateway.indexOf("url.pathname === '/api/run/start'"));
  assert.ok(block.indexOf('requireGatewayUser') < block.indexOf('runBoard'));
});
