import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL: миграция колеса повторяема и хранит годовой приз отдельно', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE
      );
    `);
    const migration = await readFile(
      new URL('../migrations/006_telegram_wheel.sql', import.meta.url),
      'utf8'
    );
    await db.exec(migration);
    await db.exec(migration);

    const user = await db.query('INSERT INTO users (telegram_id) VALUES (1001) RETURNING id');
    const spin = await db.query(
      `INSERT INTO wheel_spins (
         request_key, user_id, kind, prize_code, random_ticket
       ) VALUES ('1:wheel-request', $1, 'free', 'annual-beer', 499999)
       RETURNING id`,
      [user.rows[0].id]
    );
    await db.query(
      'INSERT INTO wheel_annual_prizes (spin_id, user_id) VALUES ($1, $2)',
      [spin.rows[0].id, user.rows[0].id]
    );
    const entitlement = await db.query(
      `SELECT daily_beer_ml, entitlement_days, (ends_on - starts_on)::integer AS duration
       FROM wheel_annual_prizes
       WHERE spin_id = $1`,
      [spin.rows[0].id]
    );
    assert.equal(Number(entitlement.rows[0].daily_beer_ml), 500);
    assert.equal(Number(entitlement.rows[0].entitlement_days), 365);
    assert.equal(Number(entitlement.rows[0].duration), 364);

    await assert.rejects(
      db.query(
        `INSERT INTO wheel_spins (
           request_key, user_id, platform, kind, prize_code, random_ticket
         ) VALUES ('1:vk-request', $1, 'vk', 'free', 'bonus-5', 0)`,
        [user.rows[0].id]
      )
    );
    await assert.rejects(
      db.query(
        `INSERT INTO wheel_spins (
           request_key, user_id, kind, prize_code, random_ticket
         ) VALUES ('1:bad-ticket', $1, 'free', 'bonus-5', 500000)`,
        [user.rows[0].id]
      )
    );
  } finally {
    await db.close();
  }
});
