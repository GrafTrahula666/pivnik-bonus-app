import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WHEEL_PRIZES,
  WHEEL_TICKET_COUNT,
  configureWheel,
  drawWheelPrize,
  freeSpinState,
  normalizeWheelSettings,
  paidSpinCost,
  selectWheelPrize,
  wheelPrizeChances,
  wheelPrizes,
  wheelSettingsSnapshot
} from '../wheel.js';

const DEFAULT_CHANCES = { 'bonus-5': 40, 'bonus-10': 20, 'bonus-20': 20, 'bonus-50': 10, 'bonus-100': 5, 'beer-glass': 5 };

test('Колесо: настройки по умолчанию дают ровно прежнюю таблицу билетов', () => {
  configureWheel({ chances: DEFAULT_CHANCES, firstPaidCost: 50, nextPaidCost: 100, freeIntervalHours: 24 });
  assert.deepEqual(wheelPrizes().map((prize) => prize.tickets), WHEEL_PRIZES.map((prize) => prize.tickets));
  assert.deepEqual(wheelSettingsSnapshot(), { chances: DEFAULT_CHANCES, firstPaidCost: 50, nextPaidCost: 100, freeIntervalHours: 24 });
  const chances = Object.fromEntries(wheelPrizeChances().map((prize) => [prize.code, prize.chancePercent]));
  assert.equal(chances['beer-glass'], 4.9999);
  assert.equal(chances['annual-beer'], 0.0001);
  configureWheel(null);
});

test('Колесо: владелец меняет шансы, цены и интервал, главный приз остаётся 1 к 1 000 000', () => {
  configureWheel({
    chances: { 'bonus-5': 50, 'bonus-10': 25, 'bonus-20': 10, 'bonus-50': 0, 'bonus-100': 5, 'beer-glass': 10 },
    firstPaidCost: 30,
    nextPaidCost: 60,
    freeIntervalHours: 12
  });
  try {
    const prizes = wheelPrizes();
    assert.equal(prizes.reduce((sum, prize) => sum + prize.tickets, 0), WHEEL_TICKET_COUNT);
    assert.equal(selectWheelPrize(249_999).code, 'bonus-5');
    assert.equal(selectWheelPrize(250_000).code, 'bonus-10');
    assert.equal(selectWheelPrize(425_000).code, 'bonus-100');
    assert.equal(selectWheelPrize(450_000).code, 'beer-glass');
    assert.equal(selectWheelPrize(499_998).code, 'beer-glass');
    assert.equal(selectWheelPrize(499_999).code, 'annual-beer');
    assert.equal(prizes.find((prize) => prize.code === 'bonus-50').tickets, 0);
    const miss = drawWheelPrize((min, max) => (max === WHEEL_TICKET_COUNT ? 499_999 : 1));
    assert.equal(miss.prize.code, 'beer-glass');
    assert.equal(paidSpinCost(0), 30);
    assert.equal(paidSpinCost(3), 60);
    const last = new Date('2026-10-09T10:00:00.000Z');
    assert.equal(freeSpinState(last, new Date('2026-10-09T21:59:59.000Z')).available, false);
    assert.equal(freeSpinState(last, new Date('2026-10-09T22:00:00.000Z')).available, true);
  } finally {
    configureWheel(null);
  }
  assert.equal(paidSpinCost(0), 50);
});

test('Колесо: неверные настройки отклоняются, а сломанная запись в базе не ломает колесо', () => {
  assert.throws(() => normalizeWheelSettings({ chances: { ...DEFAULT_CHANCES, 'bonus-5': 41 } }), /ровно 100%/);
  assert.throws(() => normalizeWheelSettings({ chances: { ...DEFAULT_CHANCES, 'bonus-5': 39.999, 'bonus-10': 20.001 } }), /двух знаков/);
  assert.throws(() => normalizeWheelSettings({ chances: { ...DEFAULT_CHANCES, 'bonus-5': 45, 'beer-glass': 0 } }), /бокала пива/);
  assert.throws(() => normalizeWheelSettings({ chances: DEFAULT_CHANCES, firstPaidCost: 0 }), /первого платного/);
  assert.throws(() => normalizeWheelSettings({ chances: DEFAULT_CHANCES, freeIntervalHours: 200 }), /Интервал/);
  configureWheel({ chances: { 'bonus-5': 100 } });
  assert.deepEqual(wheelPrizes(), WHEEL_PRIZES);
  assert.equal(paidSpinCost(1), 100);
});

test('Колесо: на время Хэллоуина доля бокала пива отдаётся хэллоуинскому билету', () => {
  const plain = drawWheelPrize((min, max) => (max === WHEEL_TICKET_COUNT ? 480_000 : 0));
  assert.equal(plain.prize.code, 'beer-glass');
  const hit = drawWheelPrize((min, max) => (max === WHEEL_TICKET_COUNT ? 480_000 : 0), { halloween: true });
  assert.equal(hit.ticket, 480_000);
  assert.equal(hit.prize.code, 'halloween-ticket');
  assert.equal(hit.prize.halloweenTicket, true);
  assert.equal(hit.prize.beerMl, 0);
  assert.equal(hit.prize.bonus, 0);
  const failedJackpot = drawWheelPrize((min, max) => (max === WHEEL_TICKET_COUNT ? 499_999 : 1), { halloween: true });
  assert.equal(failedJackpot.prize.code, 'halloween-ticket');
  const bonus = drawWheelPrize(() => 10, { halloween: true });
  assert.equal(bonus.prize.code, 'bonus-5');
  const jackpot = drawWheelPrize((min, max) => (max === WHEEL_TICKET_COUNT ? 499_999 : 0), { halloween: true });
  assert.equal(jackpot.prize.code, 'annual-beer');
});
