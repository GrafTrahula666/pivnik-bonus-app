import crypto from 'node:crypto';

export const WHEEL_TICKET_COUNT = 500_000;
export const WHEEL_FREE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const WHEEL_PRIZES = Object.freeze([
  Object.freeze({ code: 'bonus-5', title: '5 бонусов', tickets: 200_000, bonus: 5, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'bonus-10', title: '10 бонусов', tickets: 100_000, bonus: 10, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'bonus-20', title: '20 бонусов', tickets: 100_000, bonus: 20, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'bonus-50', title: '50 бонусов', tickets: 50_000, bonus: 50, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'bonus-100', title: '100 бонусов', tickets: 25_000, bonus: 100, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'beer-glass', title: 'Бокал пива', tickets: 24_999, bonus: 0, beerMl: 500, annualSupply: false }),
  Object.freeze({ code: 'annual-beer', title: 'Годовой запас пива', tickets: 1, bonus: 0, beerMl: 0, annualSupply: true })
]);

export function selectWheelPrize(ticket) {
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= WHEEL_TICKET_COUNT) {
    throw new RangeError('Wheel ticket is outside the configured range.');
  }
  let upperBound = 0;
  for (const prize of WHEEL_PRIZES) {
    upperBound += prize.tickets;
    if (ticket < upperBound) return prize;
  }
  throw new Error('Wheel prize table does not cover every ticket.');
}

export function drawWheelPrize(randomInt = crypto.randomInt) {
  const ticket = randomInt(0, WHEEL_TICKET_COUNT);
  return { ticket, prize: selectWheelPrize(ticket) };
}

export function freeSpinState(lastFreeSpinAt, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const lastMs = lastFreeSpinAt ? new Date(lastFreeSpinAt).getTime() : Number.NaN;
  if (!Number.isFinite(lastMs)) {
    return { available: true, nextAt: null, remainingMs: 0 };
  }
  const nextMs = lastMs + WHEEL_FREE_INTERVAL_MS;
  return {
    available: nowMs >= nextMs,
    nextAt: new Date(nextMs).toISOString(),
    remainingMs: Math.max(0, nextMs - nowMs)
  };
}

export function paidSpinCost(paidSpinsSinceLastFree) {
  return Number(paidSpinsSinceLastFree || 0) === 0 ? 50 : 100;
}
