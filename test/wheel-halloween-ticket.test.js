import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';

test('Колесо Хэллоуина: миграция расширяет коды призов и запускается автоматически', async () => {
  const sql = await readFile(new URL('../migrations/015_wheel_halloween_ticket.sql', import.meta.url), 'utf8');
  assert.match(sql, /'halloween-ticket'/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS wheel_spins_prize_code_check/);
  assert.equal(isAutomaticStartupMigration('015_wheel_halloween_ticket.sql'), true);
});

test('Колесо Хэллоуина: сервер выдаёт билет в той же транзакции, что и вращение', async () => {
  const source = await readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
  assert.match(source, /halloween: await halloweenWheelActive\(client\)/);
  assert.match(source, /reason: 'wheel', sourceKey: `wheel:\$\{spinRow\.id\}`/);
});

test('Колесо Хэллоуина: клиент показывает билет и ставит его на секторы бокала', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /'halloween-ticket': 'Хэллоуинский билет'/);
  assert.match(app, /code === 'halloween-ticket' \? 'beer-glass' : code/);
});

test('PostgreSQL: миграция 015 повторяема, принимает билет и билет с колеса выдаётся один раз', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { grantTickets } = await import('../halloween-raffle.js');
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE users (id BIGSERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE)');
    await db.exec(await readFile(new URL('../migrations/006_telegram_wheel.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
    const m015 = await readFile(new URL('../migrations/015_wheel_halloween_ticket.sql', import.meta.url), 'utf8');
    await db.exec(m015);
    await db.exec(m015);

    const user = await db.query('INSERT INTO users (telegram_id) VALUES (1001) RETURNING id');
    const userId = Number(user.rows[0].id);
    const spin = await db.query(
      `INSERT INTO wheel_spins (request_key, user_id, kind, prize_code, random_ticket)
       VALUES ('1:ticket', $1, 'free', 'halloween-ticket', 480000) RETURNING id`, [userId]
    );
    const sourceKey = `wheel:${spin.rows[0].id}`;
    const first = await grantTickets(db, { userId, delta: 1, reason: 'wheel', sourceKey });
    const replay = await grantTickets(db, { userId, delta: 1, reason: 'wheel', sourceKey });
    assert.deepEqual([first.applied, first.balance, replay.applied, replay.balance], [true, 1, false, 1]);

    await assert.rejects(db.query(
      `INSERT INTO wheel_spins (request_key, user_id, kind, prize_code, random_ticket)
       VALUES ('1:bad', $1, 'free', 'unknown-prize', 1)`, [userId]
    ));
    const old = await db.query(
      `INSERT INTO wheel_spins (request_key, user_id, kind, prize_code, random_ticket)
       VALUES ('1:glass', $1, 'free', 'beer-glass', 480001) RETURNING prize_code`, [userId]
    );
    assert.equal(old.rows[0].prize_code, 'beer-glass');
  } finally {
    await db.close();
  }
});

test('Колесо Хэллоуина: картинка колеса подменяется только при теме Хэллоуин', async () => {
  const [app, image] = await Promise.all([
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/home-v2/wheel-halloween-night-20261010.webp', import.meta.url))
  ]);
  assert.equal(image.subarray(0, 4).toString(), 'RIFF');
  assert.equal(image.subarray(8, 12).toString(), 'WEBP');
  assert.match(app, /applyHalloweenWheelArt\(design\.theme === 'halloween'\)/);
  assert.match(app, /const HALLOWEEN_WHEEL_ART = '\/assets\/home-v2\/wheel-halloween-night-20261010\.webp'/);
});
