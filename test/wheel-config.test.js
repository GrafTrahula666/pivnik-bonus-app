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
  wheelPrizeDefinition,
  wheelPrizes,
  wheelSettingsSnapshot,
  wheelTicketModeActive
} from '../wheel.js';

const DEFAULT_CHANCES = { 'bonus-5': 40, 'bonus-10': 20, 'bonus-20': 20, 'bonus-50': 10, 'bonus-100': 5, 'beer-glass': 5 };

test('Колесо: настройки по умолчанию дают ровно прежнюю таблицу билетов', () => {
  configureWheel({ chances: DEFAULT_CHANCES, firstPaidCost: 50, nextPaidCost: 100, freeIntervalHours: 24 });
  assert.deepEqual(wheelPrizes().map((prize) => prize.tickets), WHEEL_PRIZES.map((prize) => prize.tickets));
  assert.deepEqual(wheelSettingsSnapshot(), {
    chances: DEFAULT_CHANCES, ticketMode: false, firstPaidCost: 50, nextPaidCost: 100, freeIntervalHours: 24
  });
  const chances = Object.fromEntries(wheelPrizeChances().map((prize) => [prize.code, prize.chancePercent]));
  assert.equal(chances['beer-glass'], 4.9999);
  assert.equal(chances['annual-beer'], 0.0001);
  assert.equal(wheelTicketModeActive(), false);
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

test('Колесо: ticketMode меняет «Бокал пива» на билет «Ночь Котлов» ровно тем же тиражом, шанс ~5%, джекпот не трогается', () => {
  const ticketChances = { ...DEFAULT_CHANCES };
  delete ticketChances['beer-glass'];
  ticketChances['halloween-ticket'] = 5;

  // Без halloween-ticket в шансах настройка отклоняется — ключ обязателен, когда ticketMode включён.
  assert.throws(() => normalizeWheelSettings({ chances: DEFAULT_CHANCES, ticketMode: true }), /Билет «Ночь Котлов»/);
  // А в выключенном режиме обязателен «Бокал пива» (его тут нет — заменён на билет), а не билет.
  assert.throws(() => normalizeWheelSettings({ chances: ticketChances, ticketMode: false }), /«Бокал пива»/);
  assert.throws(
    () => normalizeWheelSettings({ chances: { ...ticketChances, 'bonus-5': 45, 'halloween-ticket': 0 }, ticketMode: true }),
    /билета «Ночь Котлов»/
  );

  configureWheel({ chances: ticketChances, ticketMode: true, firstPaidCost: 50, nextPaidCost: 100, freeIntervalHours: 24 });
  try {
    assert.equal(wheelTicketModeActive(), true);
    const prizes = wheelPrizes();
    assert.equal(prizes.reduce((sum, prize) => sum + prize.tickets, 0), WHEEL_TICKET_COUNT);
    // Same 24,999-ticket share the beer glass used to hold.
    assert.equal(prizes.find((prize) => prize.code === 'halloween-ticket').tickets, 24_999);
    assert.equal(prizes.find((prize) => prize.code === 'halloween-ticket').ticket, true);
    assert.equal(prizes.find((prize) => prize.code === 'beer-glass'), undefined);
    assert.equal(selectWheelPrize(475_000).code, 'halloween-ticket');
    assert.equal(selectWheelPrize(499_998).code, 'halloween-ticket');
    assert.equal(selectWheelPrize(499_999).code, 'annual-beer');

    const chances = Object.fromEntries(wheelPrizeChances().map((prize) => [prize.code, prize.chancePercent]));
    assert.equal(chances['halloween-ticket'], 4.9999);
    assert.equal(chances['annual-beer'], 0.0001);

    // The failed jackpot gate now lands on the ticket, not the beer glass; the gate math (1/500,000 x 1/2
    // = 1 in 1,000,000) is exactly the same draw as when ticketMode is off.
    const win = drawWheelPrize((min, max) => (max === WHEEL_TICKET_COUNT ? 499_999 : 1));
    assert.equal(win.prize.code, 'halloween-ticket');
    assert.equal(win.prize.ticket, true);
    const jackpot = drawWheelPrize((min, max) => (max === WHEEL_TICKET_COUNT ? 499_999 : 0));
    assert.equal(jackpot.prize.code, 'annual-beer');

    // A past "beer-glass" spin still resolves for history display even while ticketMode is on, and
    // vice versa once it is switched back off — one setting change, not a data migration.
    assert.equal(wheelPrizeDefinition('beer-glass').title, 'Бокал пива');
    assert.equal(wheelPrizeDefinition('halloween-ticket').title, 'Билет «Ночь Котлов»');
  } finally {
    configureWheel(null);
  }
  // One switch back: ticketMode off restores the classic beer-glass table exactly.
  assert.equal(wheelTicketModeActive(), false);
  assert.deepEqual(wheelPrizes(), WHEEL_PRIZES);
  assert.equal(wheelPrizeDefinition('halloween-ticket').title, 'Билет «Ночь Котлов»');
});
