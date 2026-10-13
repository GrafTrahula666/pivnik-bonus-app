import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WHEEL_FREE_INTERVAL_MS,
  WHEEL_JACKPOT_GATE,
  WHEEL_PRIZES,
  WHEEL_TICKET_COUNT,
  drawWheelPrize,
  freeSpinState,
  paidSpinCost,
  selectWheelPrize
} from '../wheel.js';

test('Колесо: таблица покрывает ровно 500 000 равновероятных билетов', () => {
  assert.equal(WHEEL_TICKET_COUNT, 500_000);
  assert.equal(WHEEL_PRIZES.reduce((sum, prize) => sum + prize.tickets, 0), WHEEL_TICKET_COUNT);
  assert.equal(selectWheelPrize(0).code, 'bonus-5');
  assert.equal(selectWheelPrize(199_999).code, 'bonus-5');
  assert.equal(selectWheelPrize(200_000).code, 'bonus-10');
  assert.equal(selectWheelPrize(299_999).code, 'bonus-10');
  assert.equal(selectWheelPrize(300_000).code, 'bonus-20');
  assert.equal(selectWheelPrize(399_999).code, 'bonus-20');
  assert.equal(selectWheelPrize(400_000).code, 'bonus-50');
  assert.equal(selectWheelPrize(449_999).code, 'bonus-50');
  assert.equal(selectWheelPrize(450_000).code, 'bonus-100');
  assert.equal(selectWheelPrize(474_999).code, 'bonus-100');
  assert.equal(selectWheelPrize(475_000).code, 'beer-glass');
  assert.equal(selectWheelPrize(499_998).code, 'beer-glass');
  assert.equal(selectWheelPrize(499_999).code, 'annual-beer');
});

test('Колесо: годовой запас имеет итоговый шанс ровно 1 к 1 000 000', () => {
  assert.equal(WHEEL_JACKPOT_GATE, 2);
  let call = 0;
  const win = drawWheelPrize((min, max) => {
    call += 1;
    if (call === 1) {
      assert.equal(min, 0);
      assert.equal(max, 500_000);
      return 499_999;
    }
    assert.equal(min, 0);
    assert.equal(max, 2);
    return 0;
  });
  assert.equal(win.ticket, 499_999);
  assert.equal(win.prize.code, 'annual-beer');

  call = 0;
  const miss = drawWheelPrize((min, max) => {
    call += 1;
    return call === 1 ? 499_999 : 1;
  });
  assert.equal(miss.ticket, 499_998);
  assert.equal(miss.prize.code, 'beer-glass');
});

test('Колесо: бесплатное вращение открывается ровно через 24 часа', () => {
  const last = new Date('2026-08-15T10:00:00.000Z');
  assert.equal(WHEEL_FREE_INTERVAL_MS, 86_400_000);
  assert.equal(freeSpinState(null, last).available, true);
  assert.equal(freeSpinState(last, new Date('2026-08-16T09:59:59.999Z')).available, false);
  assert.equal(freeSpinState(last, new Date('2026-08-16T10:00:00.000Z')).available, true);
  assert.equal(freeSpinState(last, last).nextAt, '2026-08-16T10:00:00.000Z');
});

test('Колесо: первое платное вращение стоит 50, следующие — 100', () => {
  assert.equal(paidSpinCost(0), 50);
  assert.equal(paidSpinCost(1), 100);
  assert.equal(paidSpinCost(2), 100);
  assert.equal(paidSpinCost(10_000), 100);
});

test('Колесо: некорректный билет не маскируется под приз', () => {
  assert.throws(() => selectWheelPrize(-1), RangeError);
  assert.throws(() => selectWheelPrize(500_000), RangeError);
  assert.throws(() => selectWheelPrize(1.5), RangeError);
});
